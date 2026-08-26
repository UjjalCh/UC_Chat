import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

/*
|--------------------------------------------------------------------------
| REQUIRED ENVIRONMENT VARIABLES
|--------------------------------------------------------------------------
*/

const requiredEnv = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
];

let hasMissingEnv = false;

for (const key of requiredEnv) {
  const value = process.env[key];

  if (value === undefined || value.trim() === "") {
    console.error(`Missing environment variable: ${key}`);
    hasMissingEnv = true;
  }
}

/*
|--------------------------------------------------------------------------
| DATABASE CONFIGURATION
|--------------------------------------------------------------------------
*/

const DB_HOST = process.env.DB_HOST;

const DB_PORT = Number(
  process.env.DB_PORT || 3306
);

const DB_USER = process.env.DB_USER;

const DB_PASSWORD = process.env.DB_PASSWORD;

const DB_NAME = process.env.DB_NAME;

/*
|--------------------------------------------------------------------------
| SSL CONFIGURATION
|--------------------------------------------------------------------------
|
| For Aiven MySQL:
|
| DB_SSL=true
|
| DB_SSL_REJECT_UNAUTHORIZED=false
|
| This is useful when you do not provide the Aiven CA certificate.
|
*/

const DB_SSL =
  String(
    process.env.DB_SSL || "false"
  ).toLowerCase() === "true";

const DB_SSL_REJECT_UNAUTHORIZED =
  String(
    process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true"
  ).toLowerCase() !== "false";

/*
|--------------------------------------------------------------------------
| POOL CONFIGURATION
|--------------------------------------------------------------------------
*/

const DB_CONNECTION_LIMIT = Number(
  process.env.DB_CONNECTION_LIMIT || 10
);

const DB_CONNECT_TIMEOUT = Number(
  process.env.DB_CONNECT_TIMEOUT || 20000
);

/*
|--------------------------------------------------------------------------
| VALIDATE DATABASE PORT
|--------------------------------------------------------------------------
*/

if (
  !Number.isInteger(DB_PORT) ||
  DB_PORT <= 0 ||
  DB_PORT > 65535
) {
  console.error(
    `Invalid DB_PORT: ${process.env.DB_PORT}`
  );

  hasMissingEnv = true;
}

/*
|--------------------------------------------------------------------------
| VALIDATE CONNECTION LIMIT
|--------------------------------------------------------------------------
*/

if (
  !Number.isInteger(DB_CONNECTION_LIMIT) ||
  DB_CONNECTION_LIMIT <= 0
) {
  console.error(
    `Invalid DB_CONNECTION_LIMIT: ${process.env.DB_CONNECTION_LIMIT}`
  );

  hasMissingEnv = true;
}

/*
|--------------------------------------------------------------------------
| VALIDATE CONNECT TIMEOUT
|--------------------------------------------------------------------------
*/

if (
  !Number.isInteger(DB_CONNECT_TIMEOUT) ||
  DB_CONNECT_TIMEOUT <= 0
) {
  console.error(
    `Invalid DB_CONNECT_TIMEOUT: ${process.env.DB_CONNECT_TIMEOUT}`
  );

  hasMissingEnv = true;
}

/*
|--------------------------------------------------------------------------
| MYSQL POOL CONFIGURATION
|--------------------------------------------------------------------------
*/

const poolConfig = {
  host: DB_HOST,

  port: DB_PORT,

  user: DB_USER,

  password: DB_PASSWORD,

  database: DB_NAME,

  waitForConnections: true,

  connectionLimit: DB_CONNECTION_LIMIT,

  queueLimit: 0,

  connectTimeout: DB_CONNECT_TIMEOUT,

  enableKeepAlive: true,

  keepAliveInitialDelay: 0,

  charset: "utf8mb4",

  timezone: "local",
};

/*
|--------------------------------------------------------------------------
| MYSQL SSL
|--------------------------------------------------------------------------
*/

if (DB_SSL) {
  poolConfig.ssl = {
    rejectUnauthorized:
      DB_SSL_REJECT_UNAUTHORIZED,
  };

  console.log(
    "MySQL SSL is enabled"
  );

  console.log(
    `MySQL SSL rejectUnauthorized: ${DB_SSL_REJECT_UNAUTHORIZED}`
  );
} else {
  console.log(
    "MySQL SSL is disabled"
  );
}

/*
|--------------------------------------------------------------------------
| CREATE MYSQL CONNECTION POOL
|--------------------------------------------------------------------------
*/

const pool = mysql.createPool(
  poolConfig
);

/*
|--------------------------------------------------------------------------
| TEST DATABASE CONNECTION
|--------------------------------------------------------------------------
*/

export const testDatabaseConnection =
  async () => {
    let connection = null;

    try {
      /*
      |--------------------------------------------------------------------------
      | Stop if configuration is missing
      |--------------------------------------------------------------------------
      */

      if (hasMissingEnv) {
        console.error(
          "----------------------------------------"
        );

        console.error(
          "Database connection was not attempted."
        );

        console.error(
          "One or more database environment variables are missing or invalid."
        );

        console.error(
          "----------------------------------------"
        );

        return false;
      }

      /*
      |--------------------------------------------------------------------------
      | Get connection
      |--------------------------------------------------------------------------
      */

      connection =
        await pool.getConnection();

      /*
      |--------------------------------------------------------------------------
      | Test query
      |--------------------------------------------------------------------------
      */

      await connection.query(
        "SELECT 1 AS database_test"
      );

      /*
      |--------------------------------------------------------------------------
      | Success
      |--------------------------------------------------------------------------
      */

      console.log(
        "----------------------------------------"
      );

      console.log(
        "MySQL database connected successfully"
      );

      console.log(
        `Database: ${DB_NAME}`
      );

      console.log(
        `Host: ${DB_HOST}:${DB_PORT}`
      );

      console.log(
        `SSL: ${DB_SSL ? "enabled" : "disabled"}`
      );

      console.log(
        "----------------------------------------"
      );

      return true;
    } catch (error) {
      /*
      |--------------------------------------------------------------------------
      | Database connection error
      |--------------------------------------------------------------------------
      */

      console.error(
        "----------------------------------------"
      );

      console.error(
        "Database connection failed"
      );

      console.error(
        "----------------------------------------"
      );

      console.error(
        "Code:",
        error?.code || "UNKNOWN"
      );

      console.error(
        "Message:",
        error?.message ||
          "Unknown database error"
      );

      /*
      |--------------------------------------------------------------------------
      | ACCESS DENIED
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        "ER_ACCESS_DENIED_ERROR"
      ) {
        console.error(
          "Database username or password is incorrect."
        );

        console.error(
          "Check DB_USER and DB_PASSWORD."
        );
      }

      /*
      |--------------------------------------------------------------------------
      | HOST NOT FOUND
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        "ENOTFOUND"
      ) {
        console.error(
          "Database host could not be found."
        );

        console.error(
          "Check DB_HOST."
        );
      }

      /*
      |--------------------------------------------------------------------------
      | CONNECTION REFUSED
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        "ECONNREFUSED"
      ) {
        console.error(
          "Database connection was refused."
        );

        console.error(
          "Check DB_HOST and DB_PORT."
        );
      }

      /*
      |--------------------------------------------------------------------------
      | CONNECTION TIMEOUT
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        "ETIMEDOUT"
      ) {
        console.error(
          "Database connection timed out."
        );

        console.error(
          "Check database availability and network access."
        );
      }

      /*
      |--------------------------------------------------------------------------
      | SSL ERROR
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
          "HANDSHAKE_SSL_ERROR" ||
        error?.code ===
          "DEPTH_ZERO_SELF_SIGNED_CERT" ||
        error?.code ===
          "SELF_SIGNED_CERT_IN_CHAIN"
      ) {
        console.error(
          "MySQL SSL certificate verification failed."
        );

        console.error(
          "For Aiven, check DB_SSL and DB_SSL_REJECT_UNAUTHORIZED."
        );
      }

      /*
      |--------------------------------------------------------------------------
      | UNKNOWN DATABASE ERROR
      |--------------------------------------------------------------------------
      */

      console.error(
        "----------------------------------------"
      );

      return false;
    } finally {
      /*
      |--------------------------------------------------------------------------
      | Release connection
      |--------------------------------------------------------------------------
      */

      if (connection) {
        connection.release();
      }
    }
  };

/*
|--------------------------------------------------------------------------
| CLOSE DATABASE
|--------------------------------------------------------------------------
*/

export const closeDatabase =
  async () => {
    try {
      await pool.end();

      console.log(
        "MySQL connection pool closed"
      );
    } catch (error) {
      console.error(
        "Error closing MySQL pool:",
        error
      );
    }
  };

/*
|--------------------------------------------------------------------------
| EXPORT POOL
|--------------------------------------------------------------------------
*/

export default pool;