const express = require('express');
const dataDBC = require('../dataDBC');
const router = express.Router();
const hashedPassword = require('../crypt.js');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const OpenAI = require('openai');
const { google } = require('googleapis');

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


// Get data from google sheet
// router.post('/getReplenishData', async (req, res) => {
//   // getReplenishData from Google
//   let credentials;
//   try {
//     const keyPath = path.resolve(__dirname, 'google-sheets-key.json');
//     credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
//   } catch (e) {
//     console.warn(
//       'google-sheets-key.json not found, trying environment variables...'
//     );
//     credentials = {
//       type: process.env.DB_GOOGLE_ACCOUNT_TYPE,
//       project_id: process.env.DB_GOOGLE_PROJECT_ID,
//       private_key_id: process.env.DB_GOOGLE_PRIVATE_KEY_ID,
//       private_key: process.env.DB_GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
//       client_email: process.env.DB_GOOGLE_CLIENT_EMAIL,
//       client_id: process.env.DB_GOOGLE_CLIENT_ID,
//       auth_uri: process.env.DB_GOOGLE_AUTH_URI,
//       token_uri: process.env.DB_GOOGLE_TOKEN_URI,
//       auth_provider_x509_cert_url:
//         process.env.DB_GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
//       client_x509_cert_url: process.env.DB_GOOGLE_CLIENT_X509_CERT_URL,
//       universe_domain: process.env.DB_GOOGLE_UNIVERSE_DOMAIN,
//     };

//     if (!credentials.private_key || !credentials.client_email) {
//       console.error(
//         'Failed to load Google credentials from file or environment variables.'
//       );
//       process.exit(1);
//     }
//   }

//   const auth = new google.auth.GoogleAuth({
//     credentials,
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
//   });

//   const sheets = google.sheets({ version: 'v4', auth });

//   const sheetId = process.env.DB_GOOGLE_SHEET_ID;
//   const range = process.env.DB_GOOGLE_SHEET_RANGE;

//   if (!sheetId) {
//     return res
//       .status(500)
//       .json({ error: 'Google Sheet ID is not configured.' });
//   }

//   try {
//     const response = await sheets.spreadsheets.values.get({
//       spreadsheetId: sheetId,
//       range: range,
//     });

//     const rows = response.data.values;
//     if (rows && rows.length) {
//       const headers = rows[0];
//       const data = rows.slice(1).map((row) => {
//         let obj = {};
//         headers.forEach((header, index) => {
//           obj[header] = row[index];
//         });
//         return obj;
//       });
//       res.json(data);
//     } else {
//       res.json([]);
//     }
//   } catch (error) {
//     console.error(
//       'Error fetching data from Google Sheets API:',
//       error.message,
//       error.stack
//     );
//     res.status(500).json({ error: 'Failed to fetch data from Google Sheets.' });
//   }
// });

module.exports = router;
