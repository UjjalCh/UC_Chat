import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "./db.js";

dotenv.config();

const router = express.Router();

/*
|--------------------------------------------------------------------------
| CONFIGURATION
|--------------------------------------------------------------------------
*/

const JWT_SECRET = process.env.JWT_SECRET;

const isProduction =
  String(process.env.NODE_ENV || "development").toLowerCase() ===
  "production";

/*
|--------------------------------------------------------------------------
| CREATE JWT
|--------------------------------------------------------------------------
*/

const createToken = (user) => {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: Number(user.id),
      email: user.email,
    },
    JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

/*
|--------------------------------------------------------------------------
| COOKIE OPTIONS
|--------------------------------------------------------------------------
|
| Local:
|   secure: false
|   sameSite: lax
|
| Production:
|   secure: true
|   sameSite: none
|
|--------------------------------------------------------------------------
*/

const getCookieOptions = () => ({
  httpOnly: true,

  secure: isProduction,

  sameSite: isProduction ? "none" : "lax",

  maxAge: 7 * 24 * 60 * 60 * 1000,

  path: "/",
});

/*
|--------------------------------------------------------------------------
| CLEAR COOKIE OPTIONS
|--------------------------------------------------------------------------
*/

const getClearCookieOptions = () => ({
  httpOnly: true,

  secure: isProduction,

  sameSite: isProduction ? "none" : "lax",

  path: "/",
});

/*
|--------------------------------------------------------------------------
| FORMAT USER
|--------------------------------------------------------------------------
*/

const formatUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: Number(user.id),

    full_name: user.full_name,

    email: user.email,

    profile_picture:
      user.profile_picture || null,

    is_online:
      Number(user.is_online) === 1,

    last_seen:
      user.last_seen || null,

    created_at:
      user.created_at || null,
  };
};

/*
|--------------------------------------------------------------------------
| AUTHENTICATION MIDDLEWARE
|--------------------------------------------------------------------------
| Reads JWT from:
|
|   uc_chat_token
|
| Then loads the user from MySQL.
|--------------------------------------------------------------------------
*/

export const authenticate = async (
  req,
  res,
  next
) => {
  try {
    /*
    |--------------------------------------------------------------------------
    | CHECK JWT SECRET
    |--------------------------------------------------------------------------
    */

    if (!JWT_SECRET) {
      console.error(
        "JWT_SECRET is missing from environment variables"
      );

      return res.status(500).json({
        ok: false,
        message:
          "Server authentication configuration error",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | GET COOKIE
    |--------------------------------------------------------------------------
    */

    const token =
      req.cookies?.uc_chat_token;

    if (!token) {
      return res.status(401).json({
        ok: false,
        message: "Not authenticated",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY JWT
    |--------------------------------------------------------------------------
    */

    let decoded;

    try {
      decoded = jwt.verify(
        token,
        JWT_SECRET
      );
    } catch (jwtError) {
      console.error(
        "JWT verification failed:",
        jwtError.message
      );

      return res.status(401).json({
        ok: false,
        message:
          "Invalid or expired session",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VALIDATE TOKEN PAYLOAD
    |--------------------------------------------------------------------------
    */

    const userId = Number(
      decoded?.id
    );

    if (
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      return res.status(401).json({
        ok: false,
        message:
          "Invalid authentication token",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | LOAD USER
    |--------------------------------------------------------------------------
    */

    const [users] =
      await pool.query(
        `
        SELECT
          id,
          full_name,
          email,
          profile_picture,
          is_online,
          last_seen,
          created_at

        FROM users

        WHERE id = ?

        LIMIT 1
        `,
        [userId]
      );

    /*
    |--------------------------------------------------------------------------
    | USER NOT FOUND
    |--------------------------------------------------------------------------
    */

    if (users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "User not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | ATTACH USER TO REQUEST
    |--------------------------------------------------------------------------
    */

    req.user = users[0];

    next();
  } catch (error) {
    console.error(
      "Authentication error:",
      error
    );

    return res.status(401).json({
      ok: false,
      message:
        "Invalid or expired session",
    });
  }
};

/*
|--------------------------------------------------------------------------
| SIGN UP
| POST /api/auth/signup
|--------------------------------------------------------------------------
*/

router.post(
  "/signup",
  async (req, res) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | CHECK DATABASE / JWT CONFIGURATION
      |--------------------------------------------------------------------------
      */

      if (!JWT_SECRET) {
        console.error(
          "JWT_SECRET is missing"
        );

        return res.status(500).json({
          ok: false,
          message:
            "Server authentication configuration error",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | GET REQUEST DATA
      |--------------------------------------------------------------------------
      */

      const {
        full_name,
        email,
        password,
      } = req.body || {};

      /*
      |--------------------------------------------------------------------------
      | REQUIRED FIELDS
      |--------------------------------------------------------------------------
      */

      if (
        full_name === undefined ||
        email === undefined ||
        password === undefined
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Full name, email and password are required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | NORMALIZE DATA
      |--------------------------------------------------------------------------
      */

      const normalizedName =
        String(full_name).trim();

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const normalizedPassword =
        String(password);

      /*
      |--------------------------------------------------------------------------
      | VALIDATE NAME
      |--------------------------------------------------------------------------
      */

      if (!normalizedName) {
        return res.status(400).json({
          ok: false,
          message:
            "Full name cannot be empty",
        });
      }

      if (
        normalizedName.length > 120
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Full name must be 120 characters or less",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE EMAIL
      |--------------------------------------------------------------------------
      */

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (
        !emailRegex.test(
          normalizedEmail
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Please enter a valid email address",
        });
      }

      if (
        normalizedEmail.length > 190
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Email address is too long",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE PASSWORD
      |--------------------------------------------------------------------------
      */

      if (
        normalizedPassword.length < 6
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Password must be at least 6 characters",
        });
      }

      if (
        normalizedPassword.length > 128
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Password is too long",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK EXISTING EMAIL
      |--------------------------------------------------------------------------
      */

      const [existingUsers] =
        await pool.query(
          `
          SELECT
            id

          FROM users

          WHERE email = ?

          LIMIT 1
          `,
          [normalizedEmail]
        );

      if (
        existingUsers.length > 0
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "An account with this email already exists",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | HASH PASSWORD
      |--------------------------------------------------------------------------
      */

      const passwordHash =
        await bcrypt.hash(
          normalizedPassword,
          12
        );

      /*
      |--------------------------------------------------------------------------
      | CREATE USER
      |--------------------------------------------------------------------------
      */

      const [result] =
        await pool.query(
          `
          INSERT INTO users
          (
            full_name,
            email,
            password_hash,
            is_online,
            last_seen
          )

          VALUES
          (
            ?,
            ?,
            ?,
            0,
            CURRENT_TIMESTAMP
          )
          `,
          [
            normalizedName,
            normalizedEmail,
            passwordHash,
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | LOAD CREATED USER
      |--------------------------------------------------------------------------
      */

      const [createdUsers] =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            profile_picture,
            is_online,
            last_seen,
            created_at

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [result.insertId]
        );

      const createdUser =
        createdUsers[0];

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.status(201).json({
        ok: true,

        message:
          "Account created successfully",

        user:
          formatUser(
            createdUser
          ),
      });
    } catch (error) {
      console.error(
        "Signup error:",
        error
      );

      /*
      |--------------------------------------------------------------------------
      | DUPLICATE EMAIL
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "An account with this email already exists",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.status(500).json({
        ok: false,
        message:
          "Unable to create account",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SIGN IN
| POST /api/auth/signin
|--------------------------------------------------------------------------
*/

router.post(
  "/signin",
  async (req, res) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | CHECK JWT SECRET
      |--------------------------------------------------------------------------
      */

      if (!JWT_SECRET) {
        console.error(
          "JWT_SECRET is missing"
        );

        return res.status(500).json({
          ok: false,
          message:
            "Server authentication configuration error",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | GET REQUEST DATA
      |--------------------------------------------------------------------------
      */

      const {
        email,
        password,
      } = req.body || {};

      /*
      |--------------------------------------------------------------------------
      | REQUIRED FIELDS
      |--------------------------------------------------------------------------
      */

      if (
        email === undefined ||
        password === undefined
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Email and password are required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | NORMALIZE EMAIL
      |--------------------------------------------------------------------------
      */

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const normalizedPassword =
        String(password);

      if (!normalizedEmail) {
        return res.status(400).json({
          ok: false,
          message:
            "Email is required",
        });
      }

      if (!normalizedPassword) {
        return res.status(400).json({
          ok: false,
          message:
            "Password is required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | FIND USER
      |--------------------------------------------------------------------------
      */

      const [users] =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            password_hash,
            profile_picture,
            is_online,
            last_seen,
            created_at

          FROM users

          WHERE email = ?

          LIMIT 1
          `,
          [normalizedEmail]
        );

      /*
      |--------------------------------------------------------------------------
      | INVALID EMAIL
      |--------------------------------------------------------------------------
      */

      if (
        users.length === 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid email or password",
        });
      }

      const user =
        users[0];

      /*
      |--------------------------------------------------------------------------
      | CHECK PASSWORD
      |--------------------------------------------------------------------------
      */

      const passwordMatches =
        await bcrypt.compare(
          normalizedPassword,
          user.password_hash
        );

      if (!passwordMatches) {
        return res.status(401).json({
          ok: false,
          message:
            "Invalid email or password",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CREATE JWT
      |--------------------------------------------------------------------------
      */

      const token =
        createToken(user);

      /*
      |--------------------------------------------------------------------------
      | UPDATE ONLINE STATUS
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE users

        SET
          is_online = 1,
          last_seen = CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [user.id]
      );

      /*
      |--------------------------------------------------------------------------
      | SET COOKIE
      |--------------------------------------------------------------------------
      */

      res.cookie(
        "uc_chat_token",
        token,
        getCookieOptions()
      );

      /*
      |--------------------------------------------------------------------------
      | RETURN USER
      |--------------------------------------------------------------------------
      */

      const signedInUser = {
        ...user,
        is_online: 1,
        last_seen: new Date(),
      };

      delete signedInUser.password_hash;

      return res.json({
        ok: true,

        message:
          "Signed in successfully",

        user:
          formatUser(
            signedInUser
          ),
      });
    } catch (error) {
      console.error(
        "Signin error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to sign in",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| CURRENT USER
| GET /api/auth/me
|--------------------------------------------------------------------------
*/

router.get(
  "/me",
  authenticate,
  async (req, res) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | LOAD CURRENT USER
      |--------------------------------------------------------------------------
      */

      const [users] =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            profile_picture,
            is_online,
            last_seen,
            created_at

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [req.user.id]
        );

      /*
      |--------------------------------------------------------------------------
      | USER NOT FOUND
      |--------------------------------------------------------------------------
      */

      if (
        users.length === 0
      ) {
        return res.status(401).json({
          ok: false,
          message:
            "User not found",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,

        user:
          formatUser(
            users[0]
          ),
      });
    } catch (error) {
      console.error(
        "Current user error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to load current user",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| LOGOUT
| POST /api/auth/logout
|--------------------------------------------------------------------------
*/

router.post(
  "/logout",
  async (req, res) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | GET TOKEN
      |--------------------------------------------------------------------------
      */

      const token =
        req.cookies?.uc_chat_token;

      /*
      |--------------------------------------------------------------------------
      | MARK USER OFFLINE
      |--------------------------------------------------------------------------
      */

      if (
        token &&
        JWT_SECRET
      ) {
        try {
          const decoded =
            jwt.verify(
              token,
              JWT_SECRET
            );

          const userId =
            Number(decoded?.id);

          if (
            Number.isInteger(
              userId
            ) &&
            userId > 0
          ) {
            await pool.query(
              `
              UPDATE users

              SET
                is_online = 0,
                last_seen =
                  CURRENT_TIMESTAMP

              WHERE id = ?
              `,
              [userId]
            );
          }
        } catch (tokenError) {
          /*
          | Token may be expired.
          | Cookie will still be cleared.
          */

          console.log(
            "Logout token verification skipped:",
            tokenError.message
          );
        }
      }

      /*
      |--------------------------------------------------------------------------
      | CLEAR COOKIE
      |--------------------------------------------------------------------------
      */

      res.clearCookie(
        "uc_chat_token",
        getClearCookieOptions()
      );

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,
        message:
          "Logged out successfully",
      });
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );

      /*
      |--------------------------------------------------------------------------
      | ALWAYS CLEAR COOKIE
      |--------------------------------------------------------------------------
      */

      res.clearCookie(
        "uc_chat_token",
        getClearCookieOptions()
      );

      return res.status(500).json({
        ok: false,
        message:
          "Unable to logout",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| EXPORT ROUTER
|--------------------------------------------------------------------------
*/

export default router;