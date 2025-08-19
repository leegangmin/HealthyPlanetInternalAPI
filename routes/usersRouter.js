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
const authenticateToken = (req, res, next) => {
  const refreshToken = req.cookies.refreshToken;
  // console.log("authenticateToken req", req);
  // console.log("authenticateToken Atoken", req.cookies.accessToken);
  // console.log("authenticateToken Rtoken", req.cookies.refreshToken);

  if (refreshToken == null) return res.sendStatus(401);

  jwt.verify(refreshToken, SECRET_KEY, (err, user) => {
    // console.log('req.user', req.user);
    // console.log('user', user);
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// get user lists
router.post('/getMembers', async (req, res) => {
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
      const accessToken = jwt.sign({ rows }, SECRET_KEY, { expiresIn: '2h' });
      const refreshToken = jwt.sign({ id }, SECRET_KEY, { expiresIn: '12h' });

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: '.gangminlee.com',
        maxAge: 2 * 60 * 60 * 1000, // 2hrs
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: '.gangminlee.com',
        maxAge: 12 * 60 * 60 * 1000, // 12hrs
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

router.post('/updatePrivilege', async (req, res) => {

  console.log(req.body)

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

router.post('/updateActive', async (req, res) => {
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

router.post('/auth', authenticateToken, async (req, res) => {
  // const { id } = req.body;
  // console.log("authenticateToken Atoken", req.cookies.accessToken);
  // console.log("authenticateToken Rtoken", req.cookies.refreshToken);

  console.log('req.body', req.body);
  console.log('req.user', req.user);
  // console.log(jwt.verify(req.cookies.refreshToken, SECRET_KEY));
  // console.log(jwt.verify(req.cookies.accessToken, SECRET_KEY));

  // console.log("router.post('/auth', authenticateToken, async (req, res) => {", req)

  let result = {
    message: true,
    user: [],
  };

  try {
    rows = await userDBC.getAccess(req.user);
  } catch (error) {
    console.log(error.message);
  } finally {
    const resultData = result;

    if (rows.length > 0 && rows[0].id == req.user.id) {
      delete rows[0]['pw'];

      result.user = rows[0];

      const id = req.user.id;
      const accessToken = jwt.sign({ rows }, SECRET_KEY, { expiresIn: '2h' });
      const refreshToken = jwt.sign({ id }, SECRET_KEY, { expiresIn: '12h' });

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: '.gangminlee.com',
        maxAge: 2 * 60 * 60 * 1000, // 2hrs
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        domain: '.gangminlee.com',
        maxAge: 12 * 60 * 60 * 1000, // 12hrs
      });

      return res.json({ resultData });
    } else {
      result.message = false;
      return res.json({ resultData });
    }
  }
});

module.exports = router;
