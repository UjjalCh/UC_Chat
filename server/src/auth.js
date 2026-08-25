import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| CREATE JWT TOKEN
|--------------------------------------------------------------------------
*/

const createToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};


/*
|--------------------------------------------------------------------------
| AUTHENTICATION MIDDLEWARE
|--------------------------------------------------------------------------
*/

export const authenticate = async (
  req,
  res,
  next
) => {
  try {
    const token =
      req.cookies.uc_chat_token;

    if (!token) {
      return res.status(401).json({
        ok: false,
        message: "Not authenticated",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const [users] =
      await pool.query(
        `
        SELECT
          id,
          full_name,
          email,
          profile_picture,
          last_seen,
          created_at

        FROM users

        WHERE id = ?

        LIMIT 1
        `,
        [decoded.id]
      );

    if (users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "User not found",
      });
    }

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
      const {
        full_name,
        email,
        password,
      } = req.body;

      /*
      |--------------------------------------------------------------------------
      | Required fields
      |--------------------------------------------------------------------------
      */

      if (
        !full_name ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Full name, email and password are required",
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Normalize input
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
      | Validate name
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
            "Full name is too long",
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Validate email
      |--------------------------------------------------------------------------
      */

      if (
        !normalizedEmail.includes("@")
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Please enter a valid email address",
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Validate password
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


      /*
      |--------------------------------------------------------------------------
      | Check existing account
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
      | Hash password
      |--------------------------------------------------------------------------
      */

      const passwordHash =
        await bcrypt.hash(
          normalizedPassword,
          12
        );


      /*
      |--------------------------------------------------------------------------
      | Create account
      |--------------------------------------------------------------------------
      */

      const [result] =
        await pool.query(
          `
          INSERT INTO users
          (
            full_name,
            email,
            password_hash
          )

          VALUES (?, ?, ?)
          `,
          [
            normalizedName,
            normalizedEmail,
            passwordHash,
          ]
        );


      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.status(201).json({
        ok: true,

        message:
          "Account created successfully",

        user: {
          id: result.insertId,
          full_name:
            normalizedName,
          email:
            normalizedEmail,
        },
      });
    } catch (error) {
      console.error(
        "Signup error:",
        error
      );

      /*
      |----------------------------------------------------------------------
      | Duplicate email protection
      |----------------------------------------------------------------------
      */

      if (
        error.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "An account with this email already exists",
        });
      }

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
      const {
        email,
        password,
      } = req.body;


      /*
      |--------------------------------------------------------------------------
      | Required fields
      |--------------------------------------------------------------------------
      */

      if (!email || !password) {
        return res.status(400).json({
          ok: false,
          message:
            "Email and password are required",
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Normalize email
      |--------------------------------------------------------------------------
      */

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();


      /*
      |--------------------------------------------------------------------------
      | Find user
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
            last_seen,
            created_at

          FROM users

          WHERE email = ?

          LIMIT 1
          `,
          [normalizedEmail]
        );


      if (users.length === 0) {
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
      | Compare password
      |--------------------------------------------------------------------------
      */

      const passwordMatches =
        await bcrypt.compare(
          String(password),
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
      | Create JWT
      |--------------------------------------------------------------------------
      */

      const token =
        createToken(user);


      /*
      |--------------------------------------------------------------------------
      | Update last seen
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE users

        SET last_seen =
          CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [user.id]
      );


      /*
      |--------------------------------------------------------------------------
      | Cookie
      |--------------------------------------------------------------------------
      */

      res.cookie(
        "uc_chat_token",
        token,
        {
          httpOnly: true,

          secure:
            process.env.NODE_ENV ===
            "production",

          sameSite:
            process.env.NODE_ENV ===
            "production"
              ? "none"
              : "lax",

          maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,

          path: "/",
        }
      );


      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.json({
        ok: true,

        message:
          "Signed in successfully",

        user: {
          id: user.id,

          full_name:
            user.full_name,

          email:
            user.email,

          profile_picture:
            user.profile_picture,

          last_seen:
            new Date(),

          created_at:
            user.created_at,
        },
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
      | Refresh last seen
      |--------------------------------------------------------------------------
      */

      await pool.query(
        `
        UPDATE users

        SET last_seen =
          CURRENT_TIMESTAMP

        WHERE id = ?
        `,
        [req.user.id]
      );


      /*
      |--------------------------------------------------------------------------
      | Return user
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
            last_seen,
            created_at

          FROM users

          WHERE id = ?

          LIMIT 1
          `,
          [req.user.id]
        );


      if (users.length === 0) {
        return res.status(401).json({
          ok: false,
          message:
            "User not found",
        });
      }


      return res.json({
        ok: true,
        user: users[0],
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
  (req, res) => {
    try {
      res.clearCookie(
        "uc_chat_token",
        {
          httpOnly: true,

          secure:
            process.env.NODE_ENV ===
            "production",

          sameSite:
            process.env.NODE_ENV ===
            "production"
              ? "none"
              : "lax",

          path: "/",
        }
      );

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