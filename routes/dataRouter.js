const express = require('express');
const dataDBC = require('../dataDBC');
const router = express.Router();
const hashedPassword = require('../crypt.js');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const OpenAI = require('openai');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const mysql = require('mysql2');

const SECRET_KEY = process.env.DB_SECRET;

// Create database connection pool for user lookup
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
const promisePool = pool.promise();

var app = express();
app.use(bodyParser.json());
app.use(cookieParser());

//verify token
const verifyAccessToken = (req, res, next) => {
  const token = req.cookies.accessToken;

  if (!token) return res.status(403).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token expired or invalid' });
  }
};

// Get data from database
router.post('/getReplenishData', verifyAccessToken, async (req, res) => {
  console.log('/getReplenishData', req.body);

  let res_get_replenish = {
    status_code: 500,
    user: '',
  };

  try {
    const rows = await dataDBC.getReplenishData(req.body);
    res_get_replenish.status_code = 200;
    if (rows.length > 0) {
      res_get_replenish.data = rows;
    } else {
      console.log('Data not found');
      res_get_replenish.data = [];
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_replenish;

    res.send(result);
  }
});

router.post('/log', async (req, res) => {
  console.log('/log', req.body);

  let res_get_log = {
    status_code: 500,
    user: '',
  };

  try {
    const rows = await dataDBC.log(req.body);
    res_get_log.status_code = 200;
    if (rows.length > 0) {
      res_get_log.data = rows;
    } else {
      console.log('Data not found');
      res_get_log.data = [];
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_log;

    res.send(result);
  }
});

// upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage });

router.post(
  '/upload',
  verifyAccessToken,
  upload.single('file'),
  async (req, res) => {
    const filePath = req.file.path;

    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      let jsonData = xlsx.utils.sheet_to_json(worksheet, { defval: null });

      const mappedData = jsonData.map((row) => ({
        item_no: row['Item No.'] || null,
        variant_code: row['Variant Code'] || '',
        brand: row['Brand'] || null,
        description: row['Description'] || null,
        sub_description: row['Description 2'] || null,
        location_code: row['Location Code'] || null,
        promo_code: row['Promo Code'] || null,
        back_ordered:
          row['Back Ordered'] === true || row['Back Ordered'] === 'TRUE'
            ? 1
            : 0,
        planogram_item:
          row['Planogram Item'] === true || row['Planogram Item'] === 'TRUE'
            ? 1
            : 0,
        daily_sales: parseFloat(row['Daily Sales']) || 0,
        inventory: parseInt(row['Inventory']) || 0,
        qty_on_po: parseInt(row['Quantity on Purchase Order']) || 0,
        qty_on_so: parseInt(row['Quantity on Sales Order']) || 0,
        qty_in_ti: parseInt(row['Quantity in Transfer In']) || 0,
        qty_in_to: parseInt(row['Quantity in Transfer Out']) || 0,
        sales_31_60days: parseInt(row['Sales-31-60Days']) || 0,
        sales_30days: parseInt(row['Sale-30Days']) || 0,
        item_division_code: row['Item Division Code'] || null,
        item_category_code: row['Item Category Code'] || null,
        item_product_group_code: row['Item Product Group Code'] || null,
        vendor_no: row['Vendor No.'] || null,
        timestamp: new Date(),
        visible: 1,
      }));

      const sanitizeRow = (row) => {
        const sanitizedRow = {};
        for (const key in row) {
          if (typeof row[key] === 'string') {
            sanitizedRow[key] = row[key].replace(/'/g, "''");
          } else {
            sanitizedRow[key] = row[key];
          }
        }
        return sanitizedRow;
      };

      const sanitizedData = mappedData.map(sanitizeRow);
      const result = await dataDBC.updateStoreData(sanitizedData);

      res.json({
        status_code: 200,
        message: 'Upload complete',
        affected_rows: result,
      });
    } catch (error) {
      console.error(error.stack);
      res.status(500).json({ status_code: 500, message: 'Upload failed' });
    } finally {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Failed to remove uploaded file:', err);
      });
    }
  }
);

router.post('/addRequestedSample', verifyAccessToken, async (req, res) => {
  const { uid, items } = req.body;

  if (!uid || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ status_code: 400, message: 'Invalid request data' });
  }

  try {
    const result = await dataDBC.addRequestedSample(uid, items);
    res.json({ status_code: 200, message: 'Request added', data: result });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ status_code: 500, message: err.message || 'Server error' });
  }
});

router.post('/getRequestedSample', verifyAccessToken, async (req, res) => {
  try {
    const result = await dataDBC.getRequestedSample(req);
    res.json({
      status_code: 200,
      data: result,
    });
  } catch (err) {
    console.error('/getRequestedSample error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/updateSampleStatus', verifyAccessToken, async (req, res) => {
  try {
    const { uid, item_no, variant_code, status } = req.body;
    const result = await dataDBC.updateSampleStatus(
      uid,
      item_no,
      variant_code,
      status
    );
    res.json({ status_code: 200, message: 'Status updated', result });
  } catch (err) {
    console.error('/updateSampleStatus error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/tooGoodToGo', async (req, res) => {
  console.log("Router", req.body)
  try {
    const result = await dataDBC.addTooGoodToGo(req.body)
    res.json({ status_code: 200, affected_rows: result })
  } catch (err) {
    console.error('/tooGoodToGo error:', err.message)
    res.status(500).json({ status_code: 500, error: err.message })
  }
})

// Sale Tag routes
router.post('/saleTag/list', verifyAccessToken, async (req, res) => {
  try {
    const result = await dataDBC.getSaleTagList();
    res.json({ status_code: 200, data: result });
  } catch (err) {
    console.error('/saleTag/list error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/saleTag/create', verifyAccessToken, async (req, res) => {
  console.log('/saleTag/create', req.body);
  try {
    const result = await dataDBC.createSaleTag(req.body);
    res.json({ status_code: 200, affected_rows: result });
  } catch (err) {
    console.error('/saleTag/create error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/saleTag/update', verifyAccessToken, async (req, res) => {
  console.log('/saleTag/update', req.body);
  try {
    const result = await dataDBC.updateSaleTag(req.body);
    res.json({ status_code: 200, affected_rows: result });
  } catch (err) {
    console.error('/saleTag/update error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

// Unmatched Sale Tag routes (saved from Excel upload)
router.post('/saleTag/unmatched/list', verifyAccessToken, async (req, res) => {
  try {
    const result = await dataDBC.getUnmatchedSaleTagList();
    res.json({ status_code: 200, data: result });
  } catch (err) {
    console.error('/saleTag/unmatched/list error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/saleTag/unmatched/save', verifyAccessToken, async (req, res) => {
  try {
    const result = await dataDBC.saveUnmatchedSaleTagRows(req.body);
    res.json({ status_code: 200, affected_rows: result });
  } catch (err) {
    console.error('/saleTag/unmatched/save error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post('/saleTag/delete', verifyAccessToken, async (req, res) => {
  console.log('/saleTag/delete', req.body);
  try {
    const result = await dataDBC.deleteSaleTag(req.body);
    res.json({ status_code: 200, affected_rows: result });
  } catch (err) {
    console.error('/saleTag/delete error:', err.message);
    res.status(500).json({ status_code: 500, error: err.message });
  }
});

router.post(
  '/saleTag/upload',
  verifyAccessToken,
  upload.single('file'),
  async (req, res) => {
    const filePath = req.file?.path;
    const { end_date, apply_to_all } = req.body;

    if (!filePath || !end_date) {
      return res.status(400).json({
        status_code: 400,
        error: 'File and end_date are required',
      });
    }

    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Parse Excel data - expect columns: Brand, Item Name (or Description), Sale Price
      let jsonData = xlsx.utils.sheet_to_json(worksheet, { defval: null });

      const applyToAll = apply_to_all === '1' || apply_to_all === true;

      console.log('Upload request - end_date:', end_date, 'apply_to_all:', applyToAll, 'rows:', jsonData.length);

      const result = await dataDBC.uploadSaleTagFromExcel(
        jsonData,
        end_date,
        applyToAll
      );

      // Save unmatched rows into DB for Counter tab fixing
      let unmatchedSaved = 0;
      try {
        const unmatchedRows = Array.isArray(result.unmatchedRows) ? result.unmatchedRows : [];
        console.log('[Upload] Unmatched rows from result:', unmatchedRows.length);
        console.log('[Upload] req.user:', JSON.stringify(req.user, null, 2));
        
        // Get uid from token - token contains 'id' (string like 'scat06'), need to look up actual uid (int) from database
        let uid = req.user?.uid; // Try uid first (if it exists)
        let userIdFromToken = req.user?.id || req.user?.userId || req.user?.user_id;
        
        // If we have id from token but not uid, look up uid from database
        if (!uid && userIdFromToken) {
          try {
            console.log('[Upload] Looking up uid for user id:', userIdFromToken);
            const [userRows] = await promisePool.query(
              'SELECT uid FROM user WHERE id = ? LIMIT 1',
              [userIdFromToken]
            );
            if (userRows && userRows.length > 0) {
              uid = userRows[0].uid;
              console.log('[Upload] Found uid:', uid, 'for user id:', userIdFromToken);
            } else {
              console.error('[Upload] User not found in database for id:', userIdFromToken);
            }
          } catch (dbErr) {
            console.error('[Upload] Failed to look up uid from database:', dbErr.message);
          }
        }
        
        // If still not found, try to decode token again
        if (!uid) {
          try {
            const token = req.cookies.accessToken;
            if (token) {
              const decoded = jwt.verify(token, SECRET_KEY);
              userIdFromToken = decoded.id || decoded.userId || decoded.user_id;
              if (userIdFromToken) {
                console.log('[Upload] Got user id from re-decoded token:', userIdFromToken);
                // Look up uid from database
                const [userRows] = await promisePool.query(
                  'SELECT uid FROM user WHERE id = ? LIMIT 1',
                  [userIdFromToken]
                );
                if (userRows && userRows.length > 0) {
                  uid = userRows[0].uid;
                  console.log('[Upload] Found uid:', uid, 'for user id:', userIdFromToken);
                }
              }
            }
          } catch (tokenErr) {
            console.error('[Upload] Failed to decode token:', tokenErr.message);
          }
        }
        
        console.log('[Upload] Final uid:', uid);
        
        if (unmatchedRows.length > 0) {
          if (!uid) {
            console.error('[Upload] Cannot save unmatched rows: uid is missing. req.user keys:', Object.keys(req.user || {}));
            throw new Error('User ID is required to save unmatched rows. Could not find uid from token.');
          }
          console.log('[Upload] Attempting to save', unmatchedRows.length, 'unmatched rows');
          unmatchedSaved = await dataDBC.saveUnmatchedSaleTagRows({
            uid: uid,
            unmatched_rows: unmatchedRows.map((r) => ({
              brand: r.brand,
              'Item Name': r.itemName,
              'Sale Price': r.salePrice,
              end_date,
            })),
            end_date,
          });
          console.log('[Upload] Successfully saved', unmatchedSaved, 'unmatched rows');
        } else {
          console.log('[Upload] No unmatched rows to save');
        }
      } catch (e) {
        console.error('[Upload] Failed to save unmatched rows:', e.message || e);
        console.error('[Upload] Error stack:', e.stack);
      }

      res.json({
        status_code: 200,
        updated_count: result.updatedCount || 0,
        excel_data: result.excelData || jsonData,
        matched_rows: result.matchedRows || [],
        unmatched_saved: unmatchedSaved,
        message: 'Upload complete',
      });
    } catch (error) {
      console.error('/saleTag/upload error:', error.stack);
      res.status(500).json({
        status_code: 500,
        error: error.message || 'Upload failed',
      });
    } finally {
      if (filePath) {
        fs.unlink(filePath, (err) => {
          if (err) console.error('Failed to remove uploaded file:', err);
        });
      }
    }
  }
);

module.exports = router;
