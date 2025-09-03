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

const promisePool = pool.promise();

const signIn = async (req) => {
  const { id, pw } = req;

  if (!id || !pw) return null;

  const [rows] = await promisePool.query('SELECT * FROM user WHERE id = ?', [
    id,
  ]);

  if (rows.length === 0) return null;

  const user = rows[0];
  const matched = await bcrypt.compare(pw, user.pw);

  return matched ? rows : [];
};

const getActive = async (req) => {
  const id = req.id;
  const promisePool = pool.promise();

  const [rows] = await promisePool.query(
    'SELECT active, privilege FROM user WHERE id = ?',
    [id]
  );

  if (rows.length === 0) return null;

  return rows[0];
};

// reset user info
const reset = async (req) => {
  const id = req.id;
  const name = req.name;
  const pw = req.password;
  const promisePool = pool.promise();

  const SALT_ROUNDS = 10;

  const hashedPassword = await bcrypt.hash(pw, SALT_ROUNDS);

  const [rows] = await promisePool.query(
    `UPDATE user SET name = ?, pw = ?, active = ? WHERE id = ?`,
    [name, hashedPassword, 1, id]
  );

  return rows;
};

const getMembers = async (req) => {
  const privilege = req.privilege;

  // console.log(privilege)

  if (privilege%100 > 3) {
    return null;
  }

  const promisePool = pool.promise();

  const [rows] = await promisePool.query(`
    SELECT 
      uid,
      id,
      name,
      location,
      privilege,
      joined_at,
      updated_at,
      active
    FROM user
  `);

  // console.log(rows)

  if (rows.length === 0) return null;

  return rows;
};

const updatePrivilege = async (req) => {
  // console.log('REQ', req);
  await promisePool.query(
    'UPDATE user SET privilege = ?, updated_at = NOW() WHERE uid = ?',
    [req.privilege, req.uid]
  );
};

const updateActive = async (req) => {
  // console.log('REQ', req);
  await promisePool.query(
    'UPDATE user SET active = ?, updated_at = NOW() WHERE uid = ?',
    [req.active ? 1 : 0, req.uid]
  );
};

module.exports = {
  signIn,
  getActive,
  reset,
  getMembers,
  updatePrivilege,
  updateActive,
};
