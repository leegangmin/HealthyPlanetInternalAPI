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

const SECRET_KEY = process.env.DB_SECRET;

var app = express();
app.use(bodyParser.json());
app.use(cookieParser());

//verify token
const authenticateToken = (req, res, next) => {
  const refreshToken = req.cookies.refreshToken;
  console.log('authenticateToken req', req);
  console.log('authenticateToken Atoken', req.cookies.accessToken);
  console.log('authenticateToken Rtoken', req.cookies.refreshToken);

  if (refreshToken == null) return res.sendStatus(401);

  // jwt.verify(refreshToken, SECRET_KEY, (err, user) => {
  //   // console.log('req.user', req.user);
  //   // console.log('user', user);
  //   if (err) return res.sendStatus(403);
  //   req.user = user;
  //   next();
  // });
};

// Get data from database
router.post('/getReplenishData', async (req, res) => {
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
    res_get_replenish.status_code = 200;
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

router.post('/upload', upload.single('file'), async (req, res) => {
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
        row['Back Ordered'] === true || row['Back Ordered'] === 'TRUE' ? 1 : 0,
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
});


router.post('/addRequestedSample', async (req, res) => {

  const { uid, items } = req.body

  if (!uid || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ status_code: 400, message: 'Invalid request data' })
  }

  try {
    const result = await dataDBC.addRequestedSample(uid, items)
    res.json({ status_code: 200, message: 'Request added', data: result })
  } catch (err) {
    console.error(err)
    res.status(500).json({ status_code: 500, message: err.message || 'Server error' })
  }
})

router.post('/getRequestedSample', async (req, res) => {

  console.log(req)

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



module.exports = router;
