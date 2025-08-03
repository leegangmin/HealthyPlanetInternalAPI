var dotenv = require('dotenv');
dotenv.config();
var express = require('express');
const cors = require('cors');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const jwt = require('jsonwebtoken');

// var indexRouter = require('./routes/index');
var usersRouter = require('./routes/usersRouter');
var dataRouter = require('./routes/dataRouter');

var app = express();
const port = 8800;

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});

// whitelist for cors
const allowedOrigins = [process.env.DB_ALLOWED_ORIGIN, 'https://hp.gangminlee.com', 'http://localhost:5173'];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allowed for tools like Postman
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    
    credentials: true,
  })
);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
app.use('/user', usersRouter);
app.use('/data', dataRouter);

module.exports = app;
