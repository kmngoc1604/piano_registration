const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON and urlencoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Database connection setup
// Adding ssl configuration which is usually required by Render PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Auto-create table if it doesn't exist when the server starts
const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20) NOT NULL,
      email VARCHAR(100) NOT NULL,
      course VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    await client.query(createTableQuery);
    client.release();
    console.log("Database table 'students' ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

// API endpoint to handle registration from the form
app.post('/api/register', async (req, res) => {
  const { fullName, phoneNumber, email, course } = req.body;

  // Basic validation
  if (!fullName || !phoneNumber || !email || !course) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin.' });
  }

  try {
    const insertQuery = `
      INSERT INTO students (full_name, phone_number, email, course)
      VALUES ($1, $2, $3, $4) RETURNING *;
    `;
    const values = [fullName, phoneNumber, email, course];
    
    const client = await pool.connect();
    const result = await client.query(insertQuery, values);
    client.release();

    res.status(201).json({ success: true, message: 'Đăng ký thành công!', data: result.rows[0] });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
