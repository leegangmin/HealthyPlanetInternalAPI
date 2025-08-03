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

const getReplenishData = async (req) => {
  const { term, value } = req;
  const promisePool = pool.promise();

  const fullTextColumns = [
    'item_no',
    'variant_code',
    'brand',
    'description',
    'sub_description',
    'vendor_no',
  ];

  // if (term === 'all') {
  //   const matchColumns = fullTextColumns.join(', ');
  //   const [rows] = await promisePool.query(
  //     `
  //     SELECT * FROM store_data
  //     WHERE MATCH (${matchColumns}) AGAINST (? IN BOOLEAN MODE)
  //     `,
  //     [`${value}*`]
  //   );
  //   return rows;
  // }

  if (term === 'all') {
    const likeClauses = fullTextColumns.map(col => `${col} LIKE ?`).join(' OR ');
    const values = fullTextColumns.map(() => `%${value}%`);
  
    const [rows] = await promisePool.query(
      `SELECT * FROM store_data WHERE ${likeClauses}`,
      values
    );
    return rows;
  }

  if (!fullTextColumns.includes(term)) {
    throw new Error('Invalid search term');
  }

  const [rows] = await promisePool.query(
    `SELECT * FROM store_data WHERE ${term} LIKE ?`,
    [`%${value}%`]
  );

  return rows;
};

const log = async (req) => {
  // console.log('log in dataDBC', req);

  const promisePool = pool.promise();
  const uid = req.uid;
  const type = req.type;
  const detail = req.detail;
  const ip = req.ip;
  const user_agent = req.user_agent;
  const rows = await promisePool.query(
    `INSERT INTO log (uid, type, detail, timestamp, ip, user_agent) VALUES (?, ?, ?, NOW(), ?, ?)`,
    [uid, type, detail, ip, user_agent]
  );

  return rows[0];
};

module.exports = {
  getReplenishData,
  log,
};
