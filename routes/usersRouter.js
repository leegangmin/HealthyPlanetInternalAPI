const express = require('express');
const bcrypt = require('bcrypt');
const userDBC = require('../userDBC');
const router = express.Router();
const hashedPassword = require('../crypt.js');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const SECRET_KEY = process.env.DB_SECRET;

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

// get user lists
router.post('/getMembers', verifyAccessToken, async (req, res) => {
  let res_get_members = {
    status_code: 500,
    data: [],
  };

  try {
    const rows = await userDBC.getMembers(req.body);
    res_get_members.status_code = 200;
    if (rows !== null) {
      res_get_members.data = rows;
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_members;

    res.send(result);
  }
});

// get user active info
router.post('/active', async (req, res) => {
  console.log(req.body);

  let res_get_active = {
    status_code: 500,
    active: null,
    privilege: null,
  };

  try {
    const rows = await userDBC.getActive(req.body);
    console.log(rows);
    res_get_active.status_code = 200;
    if (rows !== null) {
      res_get_active.active = rows.active;
      res_get_active.privilege = rows.privilege;
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_active;

    res.send(result);
  }
});

// reset user info
router.post('/reset', async (req, res) => {
  let res_get_reset = {
    status_code: 500,
    result: null,
  };

  try {
    const rows = await userDBC.reset(req.body);
    res_get_reset.status_code = 200;
    if (rows !== null) {
      res_get_reset.reset = rows;
      res_get_reset.result = true;
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_reset;

    res.send(result);
  }
});

// join user
router.post('/signup', async (req, res) => {
  console.log('/signup', req.body);

  let res_join_users = {
    status_code: 500,
    user: '',
  };

  try {
    const rows = await userDBC.joinUser(req.body);
    res_join_users.status_code = 200;

    // !!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!!!
    // need to be crypt the pw before the service
    // or use cookies instead of getting infos for auth
    // if (rows.length > 0 && rows[0].pw == req.body.pw) {
    //   delete rows[0]['pw'];
    //   res_join_users.user = rows[0];
    // } else {
    //   console.log('User not found');
    //   res_join_users.user = [];
    // }
    // console.log('/join result', rows)
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_join_users;

    res.send(result);
  }
});

// get signed in user info
router.post('/signin', async (req, res) => {
  const { id, pw } = req.body;

  let result = {
    message: true,
    user: [],
  };

  let rows = [];

  try {
    rows = await userDBC.signIn(req.body);

    // !!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!!!
    // need to be crypt the pw before the service
    // or use cookies instead of getting infos for auth
  } catch (error) {
    console.log(error.message);
  } finally {
    const resultData = result;

    if (rows.length > 0) {
      // if (rows.length > 0 && rows[0].pw == req.body.pw) {
      delete rows[0]['pw'];

      result.user = rows[0];
      const accessToken = jwt.sign({ id: rows[0].id }, SECRET_KEY, {
        expiresIn: '30m',
      });
      const refreshToken = jwt.sign({ id: rows[0].id }, SECRET_KEY, {
        expiresIn: '2h',
      });

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        maxAge: 30 * 60 * 1000,
      });
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        maxAge: 2 * 60 * 60 * 1000,
      });

      return res.json({ resultData });
    } else {
      result.message = false;
      return res.json({ resultData });
    }
  }
});

router.post('/signout', async (req, res) => {
  let result = {
    message: true,
    user: [],
  };

  let rows = [];

  try {
    // rows = await userDBC.loginUser(req.body);
  } catch (error) {
    console.log(error.message);
  } finally {
    const resultData = result;

    res.clearCookie('refreshToken', {
      domain: '.gangminlee.com',
      sameSite: 'strict',
      httpOnly: true,
      secure: true,
    });

    res.clearCookie('accessToken', {
      domain: '.gangminlee.com',
      sameSite: 'strict',
      httpOnly: true,
      secure: true,
    });

    return res.json({ resultData });
  }
});

router.post('/updatePrivilege', verifyAccessToken, async (req, res) => {
  console.log(req.body);

  try {
    const { uid, privilege } = req.body;
    const result = await userDBC.updatePrivilege(req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: 'Failed to update privilege' });
  }
});

router.post('/updateActive', verifyAccessToken, async (req, res) => {
  try {
    const { uid, active } = req.body;
    const result = await userDBC.updateActive(req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: 'Failed to update active' });
  }
});

router.post('/auth', (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  console.log('auth', refreshToken);

  if (!refreshToken)
    return res.status(401).json({ message: 'No refresh token' });

  try {
    const decoded = jwt.verify(refreshToken, SECRET_KEY);
    const newAccessToken = jwt.sign({ id: decoded.id }, SECRET_KEY, {
      expiresIn: '30m',
    });

    console.log('decoded.exp', decoded.exp);

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 30 * 60 * 1000,
    });

    res.json({ message: 'Access token refreshed' });
  } catch {
    res.status(403).json({ message: 'Invalid refresh token' });
  }
});

module.exports = router;
