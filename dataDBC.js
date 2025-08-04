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

const fullTextColumns = [
  'item_no',
  'variant_code',
  'brand',
  'description',
  'sub_description',
  'vendor_no',
];

const getReplenishData = async (req) => {
  try {
    const { term, value } = req;
    const promisePool = pool.promise();

    if (term === 'all') {
      const words = value.trim().split(/\s+/);

      // 숫자만 있는 단어와 아닌 단어 분리
      const numericWords = words.filter(w => /^\d+$/.test(w));
      const nonNumericWords = words.filter(w => !/^\d+$/.test(w));

      // FULLTEXT BOOLEAN MODE 검색용 문자열 만들기 (AND 조건)
      const booleanSearch = nonNumericWords.map(w => `+${w}*`).join(' ');

      if (numericWords.length === 0) {
        if (booleanSearch.length === 0) {
          // 검색어 없으면 빈 배열 반환
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
        // 숫자 단어가 있을 때는 복합 조건
        const fullTextCondition = booleanSearch.length > 0
          ? `MATCH (${fullTextColumns.join(', ')}) AGAINST (? IN BOOLEAN MODE)`
          : '1';

        const likeConditions = numericWords.map(() => `item_no LIKE ?`).join(' AND ');

        const sql = `
          SELECT * FROM store_data
          WHERE ${fullTextCondition}
          AND ${likeConditions}
        `;

        const params = [];
        if (booleanSearch.length > 0) {
          params.push(booleanSearch);
        }
        numericWords.forEach(nw => {
          params.push(`%${nw}`);
        });

        const [rows] = await promisePool.query(sql, params);
        return rows;
      }
    }

    // term 유효성 검사 (화이트리스트)
    if (!fullTextColumns.includes(term)) {
      throw new Error('Invalid search term');
    }

    // 단일 컬럼 검색 시 숫자-only면 뒤쪽 매칭으로 처리
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
    const promisePool = pool.promise();
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

module.exports = {
  getReplenishData,
  log,
};
