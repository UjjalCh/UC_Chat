CREATE DATABASE uc_chat;

USE uc_chat;

CREATE TABLE users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    profile_picture VARCHAR(500),
    last_seen DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    contact_user_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_contact (user_id, contact_user_id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (contact_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE conversations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    user_one_id INT UNSIGNED NOT NULL,
    user_two_id INT UNSIGNED NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_conversation (
        user_one_id,
        user_two_id
    ),

    FOREIGN KEY (user_one_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_two_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    conversation_id BIGINT UNSIGNED NOT NULL,

    sender_id INT UNSIGNED NOT NULL,

    message TEXT NOT NULL,

    message_type ENUM(
        'text',
        'image',
        'file'
    ) DEFAULT 'text',

    is_read BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    FOREIGN KEY (sender_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    INDEX idx_conversation_messages (
        conversation_id,
        created_at
    )
);

ALTER TABLE conversations
ADD COLUMN updated_at TIMESTAMP
DEFAULT CURRENT_TIMESTAMP
ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE users
ADD COLUMN is_online TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users
ADD COLUMN last_seen DATETIME NULL;
DESCRIBE conversations;
SELECT id, full_name, email
FROM users;
SHOW TABLES;
SHOW VARIABLES LIKE 'port';
SELECT DATABASE();
DESCRIBE users;
SELECT * FROM messages;