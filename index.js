const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      birth_year INT NOT NULL,
      music_level VARCHAR(100) NOT NULL,
      learning_goal TEXT,
      preferred_days TEXT,
      preferred_times TEXT,
      class_tier VARCHAR(100),
      payment_method VARCHAR(100),
      calculated_fee INT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    await client.query(createTableQuery);
    client.release();
    console.log("Database table 'registrations' ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

app.post('/api/register', async (req, res) => {
  const { 
    full_name, phone, email, birth_year, 
    music_level, learning_goal, preferred_days, 
    preferred_times, class_tier, payment_method, 
    calculated_fee, notes 
  } = req.body;

  try {
    const insertQuery = `
      INSERT INTO registrations (
        full_name, phone, email, birth_year, 
        music_level, learning_goal, preferred_days, 
        preferred_times, class_tier, payment_method, 
        calculated_fee, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *;
    `;
    
    const values = [
      full_name, phone, email, birth_year,
      music_level, learning_goal, preferred_days,
      preferred_times, class_tier, payment_method,
      calculated_fee, notes
    ];
    
    const client = await pool.connect();
    const result = await client.query(insertQuery, values);
    client.release();

    res.status(201).json({ success: true, message: 'Đăng ký thành công!' });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
