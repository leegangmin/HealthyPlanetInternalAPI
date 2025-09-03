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

module.exports = {
  getReplenishData,
  log,
  updateStoreData,
  addRequestedSample,
  getRequestedSample,
  updateSampleStatus,
  addTooGoodToGo,
};
