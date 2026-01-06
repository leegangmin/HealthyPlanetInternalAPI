const mysql = require('mysql2');
const hashedPassword = require('./crypt.js');

// Create the connection pool. The pool-specific settings are the defaults
const pool = mysql.createPool({
  host: process.env.DB_HOST_AWS,
  user: process.env.DB_USER_AWS,
  database: process.env.DB_NAME_AWS,
  password: process.env.DB_PASS_AWS,
  port: process.env.DB_PORT_AWS,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const fullTextColumns = [
  'item_no',
  'variant_code',
  'brand',
  'description',
  'sub_description',
  'vendor_no',
];

const promisePool = pool.promise();

const getReplenishData = async (req) => {
  try {
    const { term, value } = req;

    if (term === 'all') {
      const words = value.trim().split(/\s+/);

      const numericWords = words.filter((w) => /^\d+$/.test(w));
      const nonNumericWords = words.filter((w) => !/^\d+$/.test(w));

      const booleanSearch = nonNumericWords.map((w) => `+${w}*`).join(' ');

      if (numericWords.length === 0) {
        if (booleanSearch.length === 0) {
          return [];
        }
        const matchColumns = fullTextColumns.join(', ');
        const [rows] = await promisePool.query(
          `
          SELECT * FROM store_data
          WHERE MATCH (${matchColumns})
          AGAINST (? IN BOOLEAN MODE)
          `,
          [booleanSearch]
        );
        return rows;
      } else {
        const fullTextCondition =
          booleanSearch.length > 0
            ? `MATCH (${fullTextColumns.join(
                ', '
              )}) AGAINST (? IN BOOLEAN MODE)`
            : '1';

        const likeConditions = numericWords
          .map(() => `item_no LIKE ?`)
          .join(' AND ');

        const sql = `
          SELECT * FROM store_data
          WHERE ${fullTextCondition}
          AND ${likeConditions}
        `;

        const params = [];
        if (booleanSearch.length > 0) {
          params.push(booleanSearch);
        }
        numericWords.forEach((nw) => {
          params.push(`%${nw}`);
        });

        const [rows] = await promisePool.query(sql, params);
        return rows;
      }
    }

    if (!fullTextColumns.includes(term)) {
      throw new Error('Invalid search term');
    }

    let likeValue = `%${value}%`;
    if (term === 'item_no' && /^\d+$/.test(value)) {
      likeValue = `%${value}`;
    }

    const [rows] = await promisePool.query(
      `SELECT * FROM store_data WHERE ${term} LIKE ?`,
      [likeValue]
    );

    return rows;
  } catch (err) {
    console.error('getReplenishData error:', err);
    return [];
  }
};

const log = async (req) => {
  try {
    const { uid, type, detail, ip, user_agent } = req;
    const [rows] = await promisePool.query(
      `INSERT INTO log (uid, type, detail, timestamp, ip, user_agent) VALUES (?, ?, ?, NOW(), ?, ?)`,
      [uid, type, detail, ip, user_agent]
    );
    return rows;
  } catch (err) {
    console.error('log error:', err);
    return null;
  }
};

async function updateStoreData(dataArray) {
  if (dataArray.length === 0) return 0;

  const sql = `
    INSERT INTO store_data
    (item_no, variant_code, brand, description, sub_description, location_code, promo_code, back_ordered,
     planogram_item, daily_sales, inventory, qty_on_po, qty_on_so, qty_in_ti, qty_in_to, sales_31_60days,
     sales_30days, item_division_code, item_category_code, item_product_group_code, vendor_no, timestamp, visible)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      variant_code = VALUES(variant_code),
      brand = VALUES(brand),
      description = VALUES(description),
      sub_description = VALUES(sub_description),
      location_code = VALUES(location_code),
      promo_code = VALUES(promo_code),
      back_ordered = VALUES(back_ordered),
      planogram_item = VALUES(planogram_item),
      daily_sales = VALUES(daily_sales),
      inventory = VALUES(inventory),
      qty_on_po = VALUES(qty_on_po),
      qty_on_so = VALUES(qty_on_so),
      qty_in_ti = VALUES(qty_in_ti),
      qty_in_to = VALUES(qty_in_to),
      sales_31_60days = VALUES(sales_31_60days),
      sales_30days = VALUES(sales_30days),
      item_division_code = VALUES(item_division_code),
      item_category_code = VALUES(item_category_code),
      item_product_group_code = VALUES(item_product_group_code),
      vendor_no = VALUES(vendor_no),
      timestamp = VALUES(timestamp),
      visible = VALUES(visible)
  `;

  const values = dataArray.map((row) => [
    row.item_no,
    row.variant_code,
    row.brand,
    row.description,
    row.sub_description,
    row.location_code,
    row.promo_code,
    row.back_ordered,
    row.planogram_item,
    row.daily_sales,
    row.inventory,
    row.qty_on_po,
    row.qty_on_so,
    row.qty_in_ti,
    row.qty_in_to,
    row.sales_31_60days,
    row.sales_30days,
    row.item_division_code,
    row.item_category_code,
    row.item_product_group_code,
    row.vendor_no,
    row.timestamp,
    row.visible,
  ]);

  const [result] = await promisePool.query(sql, [values]);
  return result.affectedRows;
}

const addRequestedSample = async (uid, items) => {
  console.log('addRequestedSample in DBC', uid, items);

  try {
    const values = [];
    const placeholders = [];

    items.forEach((item) => {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL, 1)');
      values.push(
        uid,
        item.item_no || '', // item_no
        item.variant_code || '', // variant_code
        item.brand, // brand
        item.description, // description
        item.sub_description || '', // sub_description
        item.reason || '', // reason
        item.quantity || 1 // quantity
      );
    });

    const sql = `INSERT INTO request_sample
      (uid, item_no, variant_code, brand, description, sub_description, reason, quantity, requested_date, received_date, visible)
      VALUES ${placeholders.join(', ')}`;

    const [rows] = await promisePool.query(sql, values);
    return rows;
  } catch (err) {
    console.error('addRequestedSample error:', err);
    throw err;
  }
};

const getRequestedSample = async (req) => {
  const { uid } = req.body;
  console.log('getRequestedSample uid:', uid);

  try {
    let query = `
      SELECT 
        rs.uid,
        u.name AS username,
        rs.item_no,
        rs.variant_code,
        rs.brand,
        rs.description,
        rs.reason,
        rs.quantity,
        rs.requested_date,
        rs.received_date
      FROM request_sample rs
      JOIN user u ON rs.uid = u.uid
    `;
    const params = [];

    if (uid) {
      query += ` WHERE rs.uid = ?`;
      params.push(uid);
    }

    query += `
      ORDER BY 
        rs.received_date IS NOT NULL,
        rs.uid,
        rs.brand
    `;

    const [rows] = await promisePool.query(query, params);

    const grouped = {};
    rows.forEach((row) => {
      if (!grouped[row.uid]) {
        grouped[row.uid] = {
          uid: row.uid,
          username: row.username,
          brands: {},
        };
      }
      if (!grouped[row.uid].brands[row.brand]) {
        grouped[row.uid].brands[row.brand] = [];
      }
      grouped[row.uid].brands[row.brand].push({
        item_no: row.item_no,
        variant_code: row.variant_code,
        description: row.description,
        reason: row.reason,
        quantity: row.quantity,
        requested_date: row.requested_date,
        received_date: row.received_date,
      });
    });

    return grouped;
  } catch (err) {
    console.error('getRequestedSamples error:', err);
    throw err;
  }
};

const updateSampleStatus = async (uid, item_no, variant_code, status) => {
  console.log('__________________', uid, item_no, variant_code, status);

  try {
    let query, values;

    if (status === 'received') {
      query = `
        UPDATE request_sample 
        SET received_date = NOW()
        WHERE uid = ? AND item_no = ? AND variant_code = ?`;
      values = [uid, item_no, variant_code];
    } else if (status === 'pending') {
      query = `
        UPDATE request_sample 
        SET received_date = NULL
        WHERE uid = ? AND item_no = ? AND variant_code = ?`;
      values = [uid, item_no, variant_code];
    } else {
      throw new Error('Invalid status');
    }

    const [result] = await promisePool.query(query, values);
    return result;
  } catch (err) {
    console.error('updateSampleStatus error:', err);
    throw err;
  }
};

const addTooGoodToGo = async (data) => {
  const { uid, bag_no, bag_type, receipt_no, collected_time } = data;

  console.log("DBC", data)

  if (!collected_time) {
    throw new Error('collected_time is required');
  }

  const [result] = await promisePool.query(
    `INSERT INTO too_good_to_go (uid, bag_no, bag_type, receipt_no, collected_time) VALUES (?, ?, ?, ?, ?)`,
    [uid, bag_no, bag_type, receipt_no, collected_time]
  );

  return result.affectedRows;
};

// Sale Tag functions
const getSaleTagList = async () => {
  try {
    const [rows] = await promisePool.query(
      `SELECT * FROM sale_tag WHERE visible = 1 ORDER BY stid DESC`
    );
    return rows;
  } catch (err) {
    console.error('getSaleTagList error:', err);
    throw err;
  }
};

const createSaleTag = async (data) => {
  const { uid, brand, sale_item, discount, location, tag_type, tag_count, notes, end_date } = data;

  if (!uid || !discount || !location || !tag_count) {
    throw new Error('Required fields are missing');
  }

  const [result] = await promisePool.query(
    `INSERT INTO sale_tag (uid, brand, description, discount, location, tag_type, tag_count, note, sale_end_date, visible) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [uid, brand || null, sale_item || null, discount, location, tag_type || null, tag_count, notes || null, end_date || null]
  );

  return result.affectedRows;
};

const updateSaleTag = async (data) => {
  const { id, brand, sale_item, discount, location, tag_type, tag_count, notes, end_date } = data;

  if (!id) {
    throw new Error('ID is required for update');
  }

  if (!discount || !location || !tag_count) {
    throw new Error('Required fields are missing');
  }

  const [result] = await promisePool.query(
    `UPDATE sale_tag 
     SET brand = ?, description = ?, discount = ?, location = ?, tag_type = ?, tag_count = ?, note = ?, sale_end_date = ?
     WHERE stid = ?`,
    [brand || null, sale_item || null, discount, location, tag_type || null, tag_count, notes || null, end_date || null, id]
  );

  return result.affectedRows;
};

const deleteSaleTag = async (data) => {
  const { id } = data;

  if (!id) {
    throw new Error('ID is required for delete');
  }

  // Soft delete by setting visible to 0
  const [result] = await promisePool.query(
    `UPDATE sale_tag SET visible = 0 WHERE stid = ?`,
    [id]
  );

  return result.affectedRows;
};

const uploadSaleTagFromExcel = async (excelData, endDate, applyToAll) => {
  try {
    let totalUpdated = 0;

    for (const row of excelData) {
      // Get Brand - priority order:
      // 1. Exact column name "Brand"
      // 2. Column containing "ad outline" (e.g., " January 2026 Ad Outline")
      let brand = null;
      // Try exact column name first
      if (row.hasOwnProperty('Brand') && row['Brand'] != null && row['Brand'] !== '') {
        brand = String(row['Brand']).trim();
      } else if (row.hasOwnProperty('brand') && row['brand'] != null && row['brand'] !== '') {
        brand = String(row['brand']).trim();
      } else {
        // Try "ad outline" pattern (this is the actual Brand column in the Excel file)
        for (const key of Object.keys(row)) {
          if (key && key.toLowerCase().includes('ad outline')) {
            const value = row[key];
            // Make sure it's not a number (Sale Price is in date columns)
            if (typeof value !== 'number') {
              brand = String(value).trim();
              break;
            }
          }
        }
      }

      // Get Item Name / Description - priority order:
      // 1. Exact column name "Item Name" or "Description"
      // 2. __EMPTY (first empty column, which is Item Name in this Excel format)
      let itemName = null;
      // Try exact column names first
      if (row.hasOwnProperty('Item Name') && row['Item Name'] != null && row['Item Name'] !== '') {
        itemName = String(row['Item Name']).trim();
      } else if (row.hasOwnProperty('item name') && row['item name'] != null && row['item name'] !== '') {
        itemName = String(row['item name']).trim();
      } else if (row.hasOwnProperty('Description') && row['Description'] != null && row['Description'] !== '') {
        itemName = String(row['Description']).trim();
      } else if (row.hasOwnProperty('description') && row['description'] != null && row['description'] !== '') {
        itemName = String(row['description']).trim();
      } else {
        // Try __EMPTY (this is the actual Item Name column in the Excel file)
        if (row.hasOwnProperty('__EMPTY') && row['__EMPTY'] != null && row['__EMPTY'] !== '') {
          itemName = String(row['__EMPTY']).trim();
        }
      }

      // Get Sale Price / Discount - priority order:
      // 1. Exact column name "Sale Price" or "Price" or "Discount"
      // 2. Date-like columns (e.g., "January 8 - February 4 2026") containing numeric values
      // IMPORTANT: Do NOT use "ad outline" column for Sale Price
      let salePrice = null;
      // Try exact column names first
      if (row.hasOwnProperty('Sale Price') && row['Sale Price'] != null && row['Sale Price'] !== '') {
        const value = row['Sale Price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
        console.log(`Found Sale Price from exact column "Sale Price": "${salePrice}"`);
      } else if (row.hasOwnProperty('sale price') && row['sale price'] != null && row['sale price'] !== '') {
        const value = row['sale price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
        console.log(`Found Sale Price from exact column "sale price": "${salePrice}"`);
      } else if (row.hasOwnProperty('Price') && row['Price'] != null && row['Price'] !== '') {
        const value = row['Price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
        console.log(`Found Sale Price from exact column "Price": "${salePrice}"`);
      } else if (row.hasOwnProperty('Discount') && row['Discount'] != null && row['Discount'] !== '') {
        const value = row['Discount'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
        console.log(`Found Sale Price from exact column "Discount": "${salePrice}"`);
      } else {
        // Try date-like columns (e.g., "January 8 - February 4 2026") - these contain the discount percentage
        // But exclude "ad outline" columns
        for (const key of Object.keys(row)) {
          // Skip "ad outline" columns - these are Brand columns, not Sale Price
          if (key && key.toLowerCase().includes('ad outline')) {
            continue;
          }
          
          // Look for date-like columns (containing year)
          if (key && (key.includes('2026') || key.includes('2025') || key.includes('2024'))) {
            const value = row[key];
            
            // First check if it's a string (could be "Buy 1 Get 2nd 50%", "20% OFF", etc.)
            if (typeof value === 'string' && value.trim()) {
              // Use the string value directly as Sale Price
              salePrice = value.trim();
              console.log(`Found Sale Price from date column "${key}": "${salePrice}" (string value)`);
              break;
            } else if (typeof value === 'number') {
              if (value > 0 && value <= 1) {
                // Likely a percentage (0.2 = 20%)
                salePrice = `${(value * 100).toFixed(0)}% OFF`;
                console.log(`Found Sale Price from date column "${key}": "${salePrice}" (from numeric value: ${value})`);
                break;
              } else if (value > 1) {
                // Likely a price
                salePrice = String(value);
                console.log(`Found Sale Price from date column "${key}": "${salePrice}" (from numeric value: ${value})`);
                break;
              }
            }
          }
        }
      }
      
      // Final validation: salePrice should not be the same as brand or itemName
      if (salePrice && (String(salePrice).trim() === String(brand).trim() || String(salePrice).trim() === String(itemName).trim())) {
        console.error(`ERROR: salePrice is incorrectly set to brand or itemName! salePrice: "${salePrice}", brand: "${brand}", itemName: "${itemName}"`);
        salePrice = null;
      }

      if (!brand || !itemName || !salePrice) {
        console.log('Skipping row - missing required fields:', {
          brand,
          itemName,
          salePrice,
          row
        });
        continue;
      }

      // Normalize brand and itemName for matching (trim, lowercase, remove extra spaces, normalize special characters)
      const normalizedBrand = (brand || '').toString().trim().replace(/\s+/g, ' ').replace(/['"]/g, "'");
      const normalizedItemName = (itemName || '').toString().trim().replace(/\s+/g, ' ').replace(/['"]/g, "'");

      console.log(`Attempting to match - Brand: "${normalizedBrand}", Item: "${normalizedItemName}"`);
      console.log(`Brand length: ${normalizedBrand.length}, Item length: ${normalizedItemName.length}`);

      // Only use exact match (case-insensitive, trimmed, normalized spaces)
      // Normalize multiple spaces in database values
      const [matchingTags] = await promisePool.query(
        `SELECT stid, brand, description FROM sale_tag 
         WHERE LOWER(TRIM(REPLACE(brand, '  ', ' '))) = LOWER(?) 
         AND LOWER(TRIM(REPLACE(description, '  ', ' '))) = LOWER(?) 
         AND visible = 1`,
        [normalizedBrand, normalizedItemName]
      );
      
      // If no match, try to find what's actually in the database for debugging
      if (matchingTags.length === 0) {
        const [dbBrands] = await promisePool.query(
          `SELECT DISTINCT brand FROM sale_tag 
           WHERE LOWER(TRIM(REPLACE(brand, '  ', ' '))) LIKE LOWER(?) 
           AND visible = 1 LIMIT 5`,
          [`%${normalizedBrand.substring(0, Math.min(20, normalizedBrand.length))}%`]
        );
        const [dbItems] = await promisePool.query(
          `SELECT DISTINCT description FROM sale_tag 
           WHERE LOWER(TRIM(REPLACE(description, '  ', ' '))) LIKE LOWER(?) 
           AND visible = 1 LIMIT 5`,
          [`%${normalizedItemName.substring(0, Math.min(30, normalizedItemName.length))}%`]
        );
        console.log(`No exact match found. Searching for similar entries:`);
        console.log(`DB Brands containing "${normalizedBrand.substring(0, 20)}":`, dbBrands.map(b => `"${b.brand}"`));
        console.log(`DB Items containing "${normalizedItemName.substring(0, 30)}":`, dbItems.map(i => `"${i.description}"`));
        
        // Also try to find exact matches with different normalization
        const [exactBrandMatch] = await promisePool.query(
          `SELECT stid, brand, description FROM sale_tag 
           WHERE brand = ? AND visible = 1 LIMIT 1`,
          [brand]
        );
        const [exactItemMatch] = await promisePool.query(
          `SELECT stid, brand, description FROM sale_tag 
           WHERE description = ? AND visible = 1 LIMIT 1`,
          [itemName]
        );
        if (exactBrandMatch.length > 0) {
          console.log(`Found exact brand match (case-sensitive): "${exactBrandMatch[0].brand}"`);
        }
        if (exactItemMatch.length > 0) {
          console.log(`Found exact item match (case-sensitive): "${exactItemMatch[0].description}"`);
        }
      }

      if (matchingTags.length === 0) {
        console.log(
          `No matching tags found for Brand: "${normalizedBrand}", Item: "${normalizedItemName}"`
        );
        // Try to find similar entries for debugging
        const brandSearchTerm = normalizedBrand.length >= 3 ? normalizedBrand.substring(0, Math.min(10, normalizedBrand.length)) : normalizedBrand;
        const itemSearchTerm = normalizedItemName.length >= 5 ? normalizedItemName.substring(0, Math.min(10, normalizedItemName.length)) : normalizedItemName;
        
        const [similarBrands] = await promisePool.query(
          `SELECT DISTINCT brand FROM sale_tag WHERE LOWER(TRIM(brand)) LIKE LOWER(?) AND visible = 1 LIMIT 10`,
          [`%${brandSearchTerm}%`]
        );
        const [similarItems] = await promisePool.query(
          `SELECT DISTINCT description FROM sale_tag WHERE LOWER(TRIM(description)) LIKE LOWER(?) AND visible = 1 LIMIT 10`,
          [`%${itemSearchTerm}%`]
        );
        console.log(`Looking for Brand: "${normalizedBrand}"`);
        console.log(`Similar brands found (${similarBrands.length}):`, similarBrands.map(b => b.brand));
        console.log(`Looking for Item: "${normalizedItemName}"`);
        console.log(`Similar items found (${similarItems.length}):`, similarItems.map(i => i.description));
        continue;
      }

      console.log(
        `Found ${matchingTags.length} matching tag(s) for Brand: "${normalizedBrand}", Item: "${normalizedItemName}"`
      );
      if (matchingTags.length > 0) {
        console.log(`Matched tags:`, matchingTags.map(t => ({ stid: t.stid, brand: t.brand, description: t.description })));
      }

      console.log(
        `Found ${matchingTags.length} matching tag(s) for Brand: "${normalizedBrand}", Item: "${normalizedItemName}"`
      );

      // Ensure endDate is in YYYY-MM-DD format (parse as local date, not UTC)
      let formattedEndDate = endDate;
      if (typeof endDate === 'string' && endDate.length > 0) {
        // If it's already in YYYY-MM-DD format, use as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          formattedEndDate = endDate;
        } else {
          // Try to parse and reformat - use local timezone to avoid day shift
          const dateMatch = endDate.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            // Direct extraction from string to avoid timezone conversion
            formattedEndDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          } else {
            // Fallback to Date parsing but use local components
            const dateObj = new Date(endDate);
            if (!isNaN(dateObj.getTime())) {
              // Use local date components to avoid UTC conversion
              const year = dateObj.getFullYear();
              const month = String(dateObj.getMonth() + 1).padStart(2, '0');
              const day = String(dateObj.getDate()).padStart(2, '0');
              formattedEndDate = `${year}-${month}-${day}`;
            }
          }
        }
      }
      
      console.log(`Updating with Sale Price: "${salePrice}", endDate: "${formattedEndDate}" for Brand: "${normalizedBrand}", Item: "${normalizedItemName}"`);

      // Validate salePrice before updating
      if (!salePrice || salePrice === normalizedBrand || salePrice === normalizedItemName) {
        console.error(`ERROR: Invalid salePrice value! salePrice: "${salePrice}", brand: "${normalizedBrand}", itemName: "${normalizedItemName}"`);
        continue;
      }

      if (applyToAll) {
        // Update all matching tags - use normalized values for WHERE clause
        // Update discount (Sale Price) and sale_end_date
        const [result] = await promisePool.query(
          `UPDATE sale_tag 
           SET discount = ?, sale_end_date = ?
           WHERE LOWER(TRIM(REPLACE(brand, '  ', ' '))) = LOWER(?) 
           AND LOWER(TRIM(REPLACE(description, '  ', ' '))) = LOWER(?) 
           AND visible = 1`,
          [salePrice, formattedEndDate, normalizedBrand, normalizedItemName]
        );
        totalUpdated += result.affectedRows;
        console.log(`Updated ${result.affectedRows} tag(s) for Brand: "${normalizedBrand}", Item: "${normalizedItemName}" with Sale Price: "${salePrice}", date: "${formattedEndDate}"`);
      } else {
        // Update only the first matching tag
        const [result] = await promisePool.query(
          `UPDATE sale_tag 
           SET discount = ?, sale_end_date = ?
           WHERE stid = ? AND visible = 1`,
          [salePrice, formattedEndDate, matchingTags[0].stid]
        );
        totalUpdated += result.affectedRows;
        console.log(`Updated 1 tag (stid: ${matchingTags[0].stid}) for Brand: "${normalizedBrand}", Item: "${normalizedItemName}" with Sale Price: "${salePrice}", date: "${formattedEndDate}"`);
      }
    }

    return totalUpdated;
  } catch (err) {
    console.error('uploadSaleTagFromExcel error:', err);
    throw err;
  }
};

module.exports = {
  getReplenishData,
  log,
  updateStoreData,
  addRequestedSample,
  getRequestedSample,
  updateSampleStatus,
  addTooGoodToGo,
  getSaleTagList,
  createSaleTag,
  updateSaleTag,
  deleteSaleTag,
  uploadSaleTagFromExcel,
};
