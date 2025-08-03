const mysql = require('mysql2');
const bcrypt = require('bcrypt');
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

// ********************************** Temporary use only
const getUsers = async (req) => {
  const id = req.id;
  const promisePool = pool.promise();
  const rows = await promisePool.query(`select * from user where id='${id}';`);
  return rows[0];
};

const signUp = async (req) => {
  // console.log('joinUser in userDBC', req);

  const SALT_ROUNDS = 10;

  // const compared = await bcrypt.compare(req.body.opw, req.body.pw)

  const hashedPassword = await bcrypt.hash(req.body.pw, SALT_ROUNDS);

  console.log(hashedPassword);

  const id = req.id;
  const pw = hashedPassword;
  const name = req.name;
  const location = req.location;
  const privilege = req.privilege;
  const promisePool = pool.promise();
  const rows = await promisePool.query(
    `INSERT INTO user(id, pw, name, location, privilege, joined_at) VALUES('${id}', '${pw}', '${name}', '${location}', '${privilege}', NOW());`
  );

  return rows[0];
};

const signIn = async (req) => {
  // console.log('userDBC', req);
  const id = req.id;
  // const pw = req.pw;
  const promisePool = pool.promise();

  const rows = await promisePool.query(`select * from user where id='${id}';`);
  const compared = await bcrypt.compare(req.pw, rows[0][0].pw);

  // console.log(compared)
  // console.log(rows[0])
  

  return compared ? rows[0] : [];
};

const getAccess = async (req) => {
  const id = req.id;
  const promisePool = pool.promise();
  const rows = await promisePool.query(`select * from user where id='${id}';`);
  return rows[0];
};

module.exports = {
  getUsers,
  signUp,
  signIn,
  getAccess,
};
