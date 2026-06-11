import sqlite3
import os
import uuid
from datetime import datetime

DB_FILE = "annotation_platform.db"

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    # 1. Profiles Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT,
        created_at TEXT NOT NULL
    );
    """)
    
    # 2. Projects Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT,
        category_schema TEXT DEFAULT '[]', -- JSON string containing label tools
        created_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
    );
    """)
    
    # 3. Project Members Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT,
        user_id TEXT,
        role TEXT NOT NULL DEFAULT 'labeler', -- 'manager', 'lead', 'reviewer', 'labeler'
        PRIMARY KEY (project_id, user_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    """)
    
    # 4. Batches Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    """)
    
    # 5. Tasks Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        batch_id TEXT,
        external_id TEXT NOT NULL,
        media_url TEXT NOT NULL,          -- Path to image file, text file, or raw text content
        media_type TEXT NOT NULL,         -- 'image' or 'text'
        stage TEXT NOT NULL DEFAULT 'start', -- 'start', 'label', 'review', 'sqc', 'client_review', 'rework', 'complete'
        assignee_id TEXT,
        total_duration_sec INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
        FOREIGN KEY (assignee_id) REFERENCES profiles(id) ON DELETE SET NULL
    );
    """)
    
    # 6. Annotations Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        user_id TEXT,
        annotations_data TEXT DEFAULT '[]',       -- JSON string of shape coordinates
        classifications_data TEXT DEFAULT '{}',   -- JSON string of radios/checkboxes
        relations_data TEXT DEFAULT '[]',         -- JSON string of shape links
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    """)
    
    # 7. QA Issues Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        comment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- 'open', 'resolved'
        created_by TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE
    );
    """)
    
    # Insert default users if profiles table is empty
    cursor.execute("SELECT COUNT(*) FROM profiles;")
    if cursor.fetchone()[0] == 0:
        default_profiles = [
            ("usr-1", "manager@platform.com", "Project Creator", datetime.now().isoformat()),
            ("usr-2", "lead@platform.com", "Team Lead", datetime.now().isoformat()),
            ("usr-3", "reviewer@platform.com", "QA Reviewer", datetime.now().isoformat()),
            ("usr-4", "labeler@platform.com", "Data Labeler", datetime.now().isoformat())
        ]
        cursor.executemany("INSERT INTO profiles (id, email, full_name, created_at) VALUES (?, ?, ?, ?);", default_profiles)
        print("Inserted default user profiles.")
        
    conn.commit()
    conn.close()
    print("Database initialized successfully.")

if __name__ == "__main__":
    init_db()
