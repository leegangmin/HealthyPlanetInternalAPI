const mysql = require('mysql2');
const { google } = require('googleapis');
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

// Sale Tag functions backed by Google Sheets
const SALE_TAG_SHEET_NAME = process.env.DB_GOOGLE_SALE_TAG_SHEET_NAME || 'sale_tag';
const SALE_TAG_SPREADSHEET_ID = process.env.DB_GOOGLE_SALE_TAG_SHEET_ID || process.env.DB_GOOGLE_SHEET_ID;
const SALE_TAG_COLUMNS = [
  'stid',
  'uid',
  'brand',
  'description',
  'discount',
  'location',
  'location_code',
  'tag_type',
  'tag_count',
  'note',
  'sale_end_date',
  'visible',
  'audit',
  'tag_count_diff',
];

let sheetsClient;
let saleTagSheetReady = false;
let saleTagRowsCache = null;
let saleTagRowsCacheTime = 0;
let saleTagSheetId = null;
const SALE_TAG_CACHE_TTL_MS = Number(process.env.DB_GOOGLE_SALE_TAG_CACHE_TTL_MS || 30000);

const saleTagRange = (range) => `'${SALE_TAG_SHEET_NAME}'!${range}`;

const parseGooglePrivateKey = () => {
  const key = process.env.DB_GOOGLE_PRIVATE_KEY;
  return key ? key.replace(/\\n/g, '\n') : undefined;
};

const getSheetsClient = async () => {
  if (!SALE_TAG_SPREADSHEET_ID) {
    throw new Error('DB_GOOGLE_SALE_TAG_SHEET_ID or DB_GOOGLE_SHEET_ID is required');
  }

  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: process.env.DB_GOOGLE_ACCOUNT_TYPE || 'service_account',
        project_id: process.env.DB_GOOGLE_PROJECT_ID,
        private_key_id: process.env.DB_GOOGLE_PRIVATE_KEY_ID,
        private_key: parseGooglePrivateKey(),
        client_email: process.env.DB_GOOGLE_CLIENT_EMAIL,
        client_id: process.env.DB_GOOGLE_CLIENT_ID,
        token_uri: process.env.DB_GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

  sheetsClient = google.sheets({ version: 'v4', auth });
  }

  return sheetsClient;
};

const clearSaleTagCache = () => {
  saleTagRowsCache = null;
  saleTagRowsCacheTime = 0;
};

const resolveSaleTagSheetId = async (sheets) => {
  if (saleTagSheetId) return saleTagSheetId;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    fields: 'sheets.properties.sheetId,sheets.properties.title',
  });

  const matchedSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === SALE_TAG_SHEET_NAME
  );

  if (!matchedSheet?.properties?.sheetId) {
    throw new Error(`Sheet "${SALE_TAG_SHEET_NAME}" not found`);
  }

  saleTagSheetId = matchedSheet.properties.sheetId;
  return saleTagSheetId;
};

async function seedSaleTagSheetFromMysqlIfEmpty(sheets) {
  if (String(process.env.DB_GOOGLE_SALE_TAG_SKIP_SEED || '').toLowerCase() === 'true') {
    return;
  }

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange('A2:N2'),
  });

  if (existing.data.values?.length) {
    return;
  }

  const [rows] = await promisePool.query(
    `SELECT stid, uid, brand, description, discount, location, location_code, tag_type, tag_count, note, sale_end_date, visible, audit, tag_count_diff
     FROM sale_tag
     ORDER BY stid ASC`
  );

  if (!rows.length) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange('A:N'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows.map(saleTagToSheetRow) },
  });

  console.log(`[sale_tag] Seeded ${rows.length} rows from MySQL into Google Sheets`);
}
const ensureSaleTagSheet = async () => {
  if (saleTagSheetReady) return;

  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });
  const exists = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === SALE_TAG_SHEET_NAME
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SALE_TAG_SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SALE_TAG_SHEET_NAME } } }],
      },
    });
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange('A1:N1'),
  });

  const currentHeader = header.data.values?.[0] || [];
  if (SALE_TAG_COLUMNS.some((column, index) => currentHeader[index] !== column)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SALE_TAG_SPREADSHEET_ID,
      range: saleTagRange('A1:N1'),
      valueInputOption: 'RAW',
      requestBody: { values: [SALE_TAG_COLUMNS] },
    });
  }

  await seedSaleTagSheetFromMysqlIfEmpty(sheets);

  saleTagSheetReady = true;
};

const normalizeSheetValue = (value) => {
  if (value === undefined || value === null) return '';
  return value;
};

const numberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
};

const visibleValue = (value) => {
  if (value === undefined || value === null || value === '') return 1;
  if (value === true) return 1;
  if (value === false) return 0;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '0' || normalized === 'false' ? 0 : 1;
};

const sheetRowToSaleTag = (values, rowNumber) => {
  const row = {};
  SALE_TAG_COLUMNS.forEach((column, index) => {
    row[column] = values[index] ?? '';
  });

  return {
    stid: numberOrNull(row.stid),
    uid: numberOrNull(row.uid),
    brand: row.brand || null,
    description: row.description || null,
    discount: row.discount || '',
    location: row.location || '',
    location_code: row.location_code || null,
    tag_type: row.tag_type || null,
    tag_count: numberOrNull(row.tag_count) ?? 0,
    note: row.note || null,
    sale_end_date: row.sale_end_date || null,
    visible: visibleValue(row.visible),
    audit: row.audit || null,
    tag_count_diff: numberOrNull(row.tag_count_diff),
    _rowNumber: rowNumber,
  };
};

const saleTagToSheetRow = (tag) =>
  SALE_TAG_COLUMNS.map((column) => normalizeSheetValue(tag[column]));

const cloneSaleTagRows = (rows) => rows.map((row) => ({ ...row }));

const setSaleTagRowsCache = (rows) => {
  saleTagRowsCache = cloneSaleTagRows(rows);
  saleTagRowsCacheTime = Date.now();
};

const getCachedSaleTagRows = () => {
  if (!saleTagRowsCache) return null;
  if (Date.now() - saleTagRowsCacheTime > SALE_TAG_CACHE_TTL_MS) return null;
  return cloneSaleTagRows(saleTagRowsCache);
};

const readSaleTagRows = async ({ force = false } = {}) => {
  if (!force) {
    const cachedRows = getCachedSaleTagRows();
    if (cachedRows) return cachedRows;
  }

  await ensureSaleTagSheet();
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange('A2:N'),
  });

    const rows = (response.data.values || []).map((values, index) =>
      sheetRowToSaleTag(values, index + 2)
    );
  setSaleTagRowsCache(rows);
  return cloneSaleTagRows(rows);
};
const nextSaleTagId = (rows) =>
  rows.reduce((max, row) => {
    const id = Number(row.stid);
    return Number.isFinite(id) && id > max ? id : max;
  }, 0) + 1;

const appendSaleTags = async (tags) => {
  if (tags.length === 0) return 0;

  await ensureSaleTagSheet();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange('A:N'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: tags.map(saleTagToSheetRow) },
  });

  if (saleTagRowsCache) {
    const startRowNumber = saleTagRowsCache.length + 2;
    saleTagRowsCache = [
      ...saleTagRowsCache,
      ...tags.map((tag, index) => ({ ...tag, _rowNumber: startRowNumber + index })),
    ];
    saleTagRowsCacheTime = Date.now();
  }

  return tags.length;
};
const updateSaleTagRow = async (rowNumber, tag) => {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    range: saleTagRange(`A${rowNumber}:N${rowNumber}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [saleTagToSheetRow(tag)] },
  });

  if (saleTagRowsCache) {
    saleTagRowsCache = saleTagRowsCache.map((row) =>
      row._rowNumber === rowNumber ? { ...tag, _rowNumber: rowNumber } : row
    );
    saleTagRowsCacheTime = Date.now();
  }
};
const updateSaleTagRows = async (tags) => {
  if (tags.length === 0) return 0;

  await ensureSaleTagSheet();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: tags.map((tag) => ({
        range: saleTagRange(`A${tag._rowNumber}:N${tag._rowNumber}`),
        values: [saleTagToSheetRow(tag)],
      })),
    },
  });

  if (saleTagRowsCache) {
    const updatedByRow = new Map(tags.map((tag) => [tag._rowNumber, tag]));
    saleTagRowsCache = saleTagRowsCache.map((row) =>
      updatedByRow.has(row._rowNumber) ? { ...updatedByRow.get(row._rowNumber) } : row
    );
    saleTagRowsCacheTime = Date.now();
  }

  return tags.length;
};

const deleteSaleTagRowsFromSheet = async (rowNumbers) => {
  if (!rowNumbers || rowNumbers.length === 0) return 0;

  const sheets = await getSheetsClient();
  const sheetId = await resolveSaleTagSheetId(sheets);

  const uniqueRows = Array.from(new Set(rowNumbers))
    .filter((rowNumber) => Number.isFinite(Number(rowNumber)))
    .map((rowNumber) => Number(rowNumber))
    .filter((rowNumber) => rowNumber >= 2)
    .sort((a, b) => b - a);

  if (uniqueRows.length === 0) return 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SALE_TAG_SPREADSHEET_ID,
    requestBody: {
      requests: uniqueRows.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })),
    },
  });

  clearSaleTagCache();
  return uniqueRows.length;
};
const normalizeForSaleTagMatch = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['"]/g, "'")
    .toLowerCase();

const applySaleTagFields = (tag, data) => {
  const next = { ...tag };

  if (data.brand !== undefined) next.brand = data.brand || null;
  if (data.sale_item !== undefined) next.description = data.sale_item || null;
  if (data.description !== undefined) next.description = data.description || null;
  if (data.discount !== undefined) next.discount = data.discount;
  if (data.location !== undefined) next.location = data.location;
  if (data.location_code !== undefined) next.location_code = data.location_code || null;
  if (data.tag_type !== undefined) next.tag_type = data.tag_type || null;
  if (data.tag_count !== undefined) next.tag_count = data.tag_count;
  if (data.notes !== undefined) next.note = data.notes || null;
  if (data.note !== undefined) next.note = data.note || null;
  if (data.end_date !== undefined) next.sale_end_date = data.end_date || null;
  if (data.sale_end_date !== undefined) next.sale_end_date = data.sale_end_date || null;
  if (data.audit !== undefined) next.audit = data.audit;
  if (data.tag_count_diff !== undefined) next.tag_count_diff = data.tag_count_diff === null ? null : data.tag_count_diff;
  if (data.visible !== undefined) next.visible = visibleValue(data.visible);

  return next;
};

const buildSaleTag = (data, stid) => ({
  stid,
  uid: data.uid,
  brand: data.brand || null,
  description: data.sale_item || data.description || null,
  discount: data.discount,
  location: data.location,
  location_code: data.location_code || null,
  tag_type: data.tag_type || null,
  tag_count: data.tag_count,
  note: data.notes || data.note || null,
  sale_end_date: data.end_date || data.sale_end_date || null,
  visible: visibleValue(data.visible),
  audit: data.audit || null,
  tag_count_diff: data.tag_count_diff === undefined ? null : data.tag_count_diff,
});

const getSaleTagList = async () => {
  try {
    const rows = await readSaleTagRows();
    return rows
      .filter((row) => visibleValue(row.visible) === 1)
      .sort((a, b) => Number(b.stid || 0) - Number(a.stid || 0))
      .map(({ _rowNumber, ...row }) => row);
  } catch (err) {
    console.error('getSaleTagList error:', err);
    throw err;
  }
};

// Unmatched Sale Tag functions (saved from Excel upload when no DB match)
const getUnmatchedSaleTagList = async () => {
  try {
    const rows = await readSaleTagRows();
    return rows
      .filter((row) => visibleValue(row.visible) === 0 && row.note === 'UNMATCHED')
      .sort((a, b) => Number(b.stid || 0) - Number(a.stid || 0))
      .map(({ _rowNumber, ...row }) => row);
  } catch (err) {
    console.error('getUnmatchedSaleTagList error:', err);
    throw err;
  }
};

const saveUnmatchedSaleTagRows = async (data) => {
  const { uid, unmatched_rows, end_date } = data || {};

  console.log('[saveUnmatchedSaleTagRows] Called with:', { uid, unmatched_rows_count: unmatched_rows?.length, end_date });

  if (!uid) {
    console.error('[saveUnmatchedSaleTagRows] Error: uid is required');
    throw new Error('uid is required');
  }
  if (!Array.isArray(unmatched_rows) || unmatched_rows.length === 0) {
    console.log('[saveUnmatchedSaleTagRows] No unmatched rows to save');
    return 0;
  }

  const existingRows = await readSaleTagRows();
  let stid = nextSaleTagId(existingRows);
  const tags = unmatched_rows.map((r) => {
    const brand = r.brand ?? r.Brand ?? null;
    const description = r.itemName ?? r['Item Name'] ?? r.description ?? r.Description ?? null;
    const discount = r.salePrice ?? r['Sale Price'] ?? r.discount ?? r.Discount ?? '';
    const saleEnd = r.sale_end_date ?? r.end_date ?? end_date ?? null;

    return buildSaleTag(
      {
        uid,
        brand,
        description,
        discount: String(discount ?? ''),
        location: 'UNMATCHED',
        tag_type: null,
        tag_count: 0,
        note: 'UNMATCHED',
        sale_end_date: saleEnd,
        visible: 0,
      },
      stid++
    );
  });

  try {
    const insertedCount = await appendSaleTags(tags);
    console.log('[saveUnmatchedSaleTagRows] Successfully inserted', insertedCount, 'out of', tags.length, 'rows');
    return insertedCount;
  } catch (err) {
    console.error('[saveUnmatchedSaleTagRows] Google Sheets error:', err.message);
    console.error('[saveUnmatchedSaleTagRows] Error stack:', err.stack);
    throw err;
  }
};

const createSaleTag = async (data) => {
  const { uid, discount, location, tag_count } = data;

  if (!uid || !discount || !location || !tag_count) {
    throw new Error('Required fields are missing');
  }

  const rows = await readSaleTagRows();
  const tag = buildSaleTag({ ...data, visible: 1 }, nextSaleTagId(rows));
  return appendSaleTags([tag]);
};

const updateSaleTag = async (data) => {
  const { id } = data;

  if (!id) {
    throw new Error('ID is required for update');
  }

  const rows = await readSaleTagRows();
  const tag = rows.find((row) => String(row.stid) === String(id));

  if (!tag) {
    return 0;
  }

  const updatedTag = applySaleTagFields(tag, data);
  await updateSaleTagRow(tag._rowNumber, updatedTag);
  return 1;
};

const deleteSaleTag = async (data) => {
  const { id } = data;

  if (!id) {
    throw new Error('ID is required for delete');
  }

  return updateSaleTag({ id, visible: 0 });
};
const optimizeSaleTags = async () => {
  try {
    const rows = await readSaleTagRows({ force: true });
    const visibleRows = rows.filter((row) => visibleValue(row.visible) === 1);
    const groups = new Map();

    visibleRows.forEach((row) => {
      const key = [
        row.brand,
        row.description,
        row.discount,
        row.location,
        row.tag_type,
      ]
        .map(normalizeForSaleTagMatch)
        .join('||');

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(row);
    });

    const updates = [];
    const deleteRows = [];
    let mergedRows = 0;
    let mergedGroups = 0;

    groups.forEach((groupRows) => {
      if (groupRows.length < 2) return;

      const [keeper, ...duplicates] = groupRows.sort(
        (a, b) => Number(a.stid || 0) - Number(b.stid || 0)
      );
      const totalTagCount = groupRows.reduce((sum, row) => {
        const count = Number(row.tag_count || 0);
        return sum + (Number.isFinite(count) ? count : 0);
      }, 0);

      updates.push({
        ...keeper,
        tag_count: totalTagCount,
        visible: 1,
      });
      duplicates.forEach((row) => {
        if (Number.isFinite(Number(row._rowNumber))) {
          deleteRows.push(Number(row._rowNumber));
        }
      });

      mergedGroups += 1;
      mergedRows += duplicates.length;
    });

    if (updates.length > 0) {
      await updateSaleTagRows(updates);
    }
    if (deleteRows.length > 0) {
      await deleteSaleTagRowsFromSheet(deleteRows);
    }

    return {
      merged_groups: mergedGroups,
      merged_rows: mergedRows,
      updated_rows: updates.length,
      deleted_rows: deleteRows.length,
    };
  } catch (err) {
    console.error('optimizeSaleTags error:', err);
    throw err;
  }
};


const uploadSaleTagFromExcel = async (excelData, endDate, applyToAll) => {
  try {
    let totalUpdated = 0;
    const matchedRows = new Set();
    const unmatchedRows = [];
    const pendingUpdatedTags = new Map();
    const saleTags = await readSaleTagRows();

    for (let rowIndex = 0; rowIndex < excelData.length; rowIndex++) {
      const row = excelData[rowIndex];
      let brand = null;

      if (row.hasOwnProperty('Brand') && row['Brand'] != null && row['Brand'] !== '') {
        brand = String(row['Brand']).trim();
      } else if (row.hasOwnProperty('brand') && row['brand'] != null && row['brand'] !== '') {
        brand = String(row['brand']).trim();
      } else {
        for (const key of Object.keys(row)) {
          if (key && key.toLowerCase().includes('ad outline')) {
            const value = row[key];
            if (typeof value !== 'number') {
              brand = String(value).trim();
              break;
            }
          }
        }
      }

      let itemName = null;
      if (row.hasOwnProperty('Item Name') && row['Item Name'] != null && row['Item Name'] !== '') {
        itemName = String(row['Item Name']).trim();
      } else if (row.hasOwnProperty('item name') && row['item name'] != null && row['item name'] !== '') {
        itemName = String(row['item name']).trim();
      } else if (row.hasOwnProperty('Description') && row['Description'] != null && row['Description'] !== '') {
        itemName = String(row['Description']).trim();
      } else if (row.hasOwnProperty('description') && row['description'] != null && row['description'] !== '') {
        itemName = String(row['description']).trim();
      } else if (row.hasOwnProperty('__EMPTY') && row['__EMPTY'] != null && row['__EMPTY'] !== '') {
        itemName = String(row['__EMPTY']).trim();
      }

      let salePrice = null;
      if (row.hasOwnProperty('Sale Price') && row['Sale Price'] != null && row['Sale Price'] !== '') {
        const value = row['Sale Price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
      } else if (row.hasOwnProperty('sale price') && row['sale price'] != null && row['sale price'] !== '') {
        const value = row['sale price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
      } else if (row.hasOwnProperty('Price') && row['Price'] != null && row['Price'] !== '') {
        const value = row['Price'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
      } else if (row.hasOwnProperty('Discount') && row['Discount'] != null && row['Discount'] !== '') {
        const value = row['Discount'];
        salePrice = typeof value === 'number' ? String(value) : String(value).trim();
      } else {
        for (const key of Object.keys(row)) {
          if (key && key.toLowerCase().includes('ad outline')) {
            continue;
          }

          if (key && (key.includes('2026') || key.includes('2025') || key.includes('2024'))) {
            const value = row[key];

            if (typeof value === 'string' && value.trim()) {
              salePrice = value.trim();
              break;
            } else if (typeof value === 'number') {
              if (value > 0 && value <= 1) {
                salePrice = `${(value * 100).toFixed(0)}% OFF`;
                break;
              } else if (value > 1) {
                salePrice = String(value);
                break;
              }
            }
          }
        }
      }

      if (salePrice && (String(salePrice).trim() === String(brand).trim() || String(salePrice).trim() === String(itemName).trim())) {
        console.error(`ERROR: salePrice is incorrectly set to brand or itemName! salePrice: "${salePrice}", brand: "${brand}", itemName: "${itemName}"`);
        salePrice = null;
      }

      if (!brand || !itemName || !salePrice) {
        console.log('Skipping row - missing required fields:', { brand, itemName, salePrice, row });
        continue;
      }

      const normalizedBrand = (brand || '').toString().trim().replace(/\s+/g, ' ').replace(/['"]/g, "'");
      const normalizedItemName = (itemName || '').toString().trim().replace(/\s+/g, ' ').replace(/['"]/g, "'");

      const matchingTags = saleTags.filter(
        (tag) =>
          visibleValue(tag.visible) === 1 &&
          normalizeForSaleTagMatch(tag.brand) === normalizeForSaleTagMatch(normalizedBrand) &&
          normalizeForSaleTagMatch(tag.description) === normalizeForSaleTagMatch(normalizedItemName)
      );

      if (matchingTags.length === 0) {
        unmatchedRows.push({
          brand: normalizedBrand,
          itemName: normalizedItemName,
          salePrice,
        });
        console.log(`No match found - added to unmatched rows: Brand: "${normalizedBrand}", Item: "${normalizedItemName}", Price: "${salePrice}"`);
        continue;
      }

      matchedRows.add(rowIndex);

      let formattedEndDate = endDate;
      if (typeof endDate === 'string' && endDate.length > 0) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          formattedEndDate = endDate;
        } else {
          const dateMatch = endDate.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            formattedEndDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          } else {
            const dateObj = new Date(endDate);
            if (!isNaN(dateObj.getTime())) {
              const year = dateObj.getFullYear();
              const month = String(dateObj.getMonth() + 1).padStart(2, '0');
              const day = String(dateObj.getDate()).padStart(2, '0');
              formattedEndDate = `${year}-${month}-${day}`;
            }
          }
        }
      }

      if (!salePrice || salePrice === normalizedBrand || salePrice === normalizedItemName) {
        console.error(`ERROR: Invalid salePrice value! salePrice: "${salePrice}", brand: "${normalizedBrand}", itemName: "${normalizedItemName}"`);
        continue;
      }

      const tagsToUpdate = applyToAll ? matchingTags : [matchingTags[0]];
      tagsToUpdate.forEach((tag) => {
        tag.discount = salePrice;
        tag.sale_end_date = formattedEndDate;
      });
      tagsToUpdate.forEach((tag) => pendingUpdatedTags.set(tag._rowNumber, { ...tag }));
      totalUpdated += tagsToUpdate.length;
      console.log(`Updated ${tagsToUpdate.length} tag(s) for Brand: "${normalizedBrand}", Item: "${normalizedItemName}" with Sale Price: "${salePrice}", date: "${formattedEndDate}"`);
    }

    if (pendingUpdatedTags.size > 0) {
      await updateSaleTagRows(Array.from(pendingUpdatedTags.values()));
    }

    console.log(`Total unmatched rows collected: ${unmatchedRows.length}`);

    return {
      updatedCount: totalUpdated,
      matchedRows: Array.from(matchedRows),
      excelData,
      unmatchedRows,
    };
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
  getUnmatchedSaleTagList,
  saveUnmatchedSaleTagRows,
  createSaleTag,
  updateSaleTag,
  deleteSaleTag,
  optimizeSaleTags,
  uploadSaleTagFromExcel,
};
