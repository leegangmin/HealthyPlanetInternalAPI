// import crypto, { randomBytes } from 'crypto';
const crypto = require('crypto');

const password = ""

// hashing password
function hashPassword(password) {
  // generate salt
  // const salt = .randomBytes(16).toString('hex');
  const salt = process.env.DB_SALT;
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'SHA512')
    .toString('hex');

  return hash;
}

// save password after hashing
const hashedPassword = hashPassword(password);

module.exports = hashPassword, hashedPassword;
