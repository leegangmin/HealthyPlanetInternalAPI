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

// get user info (just for testing, will be discontinued)
router.post('/getusers', async (req, res) => {
  console.log(req.body);

  let res_get_users = {
    status_code: 500,
    user: '',
  };

  try {
    const rows = await userDBC.getUsers(req.body);
    res_get_users.status_code = 200;
    if (rows.length > 0) {
      res_get_users.user = rows;
    } else {
      console.log('User not found');
      res_get_users.user = [];
    }
  } catch (error) {
    console.log(error.message);
  } finally {
    const result = res_get_users;

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

  // console.log('/signin in usersRouter.js');
  // console.log(req.body);

  // const compared = await bcrypt.compare(req.body.pw, rows[0][0].pw);
  // console.log('compared', compared)

  // one-way hashing the password before access to database
  // if (req.body.pw !== null || req.body.pw !== '') {
  //   req.body.pw = hashedPassword(req.body.pw);
  // }

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
