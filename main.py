import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uuid
import json
from datetime import datetime
import os

from database import get_db_connection, init_db

# Initialize database tables on startup
init_db()

app = FastAPI(title="Multi-Modal Annotation Platform API")

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for Requests ---
class ProfileCreate(BaseModel):
    id: str
    email: str
    full_name: str

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    created_by: str

class SchemaUpdate(BaseModel):
    category_schema: List[Dict[str, Any]]

class MemberAdd(BaseModel):
    user_id: str
    role: str

class MemberUpdate(BaseModel):
    role: str

class BatchCreate(BaseModel):
    name: str

class TaskCreate(BaseModel):
    external_id: str
    media_url: str
    media_type: str  # 'image' or 'text'
    batch_id: Optional[str] = None

class AnnotationsSave(BaseModel):
    user_id: str
    annotations_data: List[Dict[str, Any]]
    classifications_data: Dict[str, Any]
    relations_data: List[Dict[str, Any]]

class IssueCreate(BaseModel):
    comment: str
    created_by: str

class IssueStatusUpdate(BaseModel):
    status: str  # 'open' or 'resolved'

# --- API Endpoints ---

# Profiles
@app.get("/api/profiles")
def get_profiles():
    conn = get_db_connection()
    profiles = conn.execute("SELECT * FROM profiles;").fetchall()
    conn.close()
    return [dict(p) for p in profiles]

# Projects
@app.get("/api/projects")
def get_projects():
    conn = get_db_connection()
    projects = conn.execute("SELECT * FROM projects;").fetchall()
    conn.close()
    
    result = []
    for proj in projects:
        d = dict(proj)
        d['category_schema'] = json.loads(d['category_schema'])
        result.append(d)
    return result

@app.post("/api/projects")
def create_project(proj: ProjectCreate):
    conn = get_db_connection()
    proj_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    try:
        conn.execute(
            "INSERT INTO projects (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?);",
            (proj_id, proj.name, proj.description, proj.created_by, now)
        )
        # Add creator as Manager automatically
        conn.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?);",
            (proj_id, proj.created_by, 'manager')
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    
    conn.close()
    return {"id": proj_id, "name": proj.name}

@app.get("/api/projects/{proj_id}")
def get_project(proj_id: str):
    conn = get_db_connection()
    proj = conn.execute("SELECT * FROM projects WHERE id = ?;", (proj_id,)).fetchone()
    conn.close()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    d = dict(proj)
    d['category_schema'] = json.loads(d['category_schema'])
    return d

@app.put("/api/projects/{proj_id}/schema")
def update_project_schema(proj_id: str, payload: SchemaUpdate):
    conn = get_db_connection()
    proj = conn.execute("SELECT id FROM projects WHERE id = ?;", (proj_id,)).fetchone()
    if not proj:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    
    conn.execute(
        "UPDATE projects SET category_schema = ? WHERE id = ?;",
        (json.dumps(payload.category_schema), proj_id)
    )
    conn.commit()
    conn.close()
    return {"status": "success"}

# Project Members
@app.get("/api/projects/{proj_id}/members")
def get_project_members(proj_id: str):
    conn = get_db_connection()
    members = conn.execute("""
        SELECT pm.user_id, pm.role, p.email, p.full_name
        FROM project_members pm
        JOIN profiles p ON pm.user_id = p.id
        WHERE pm.project_id = ?;
    """, (proj_id,)).fetchall()
    conn.close()
    return [dict(m) for m in members]

@app.post("/api/projects/{proj_id}/members")
def add_project_member(proj_id: str, member: MemberAdd):
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?);",
            (proj_id, member.user_id, member.role)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail="User already in project or invalid ID")
    conn.close()
    return {"status": "success"}

@app.put("/api/projects/{proj_id}/members/{user_id}")
def update_project_member(proj_id: str, user_id: str, member: MemberUpdate):
    conn = get_db_connection()
    cursor = conn.execute(
        "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?;",
        (member.role, proj_id, user_id)
    )
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"status": "success"}

@app.delete("/api/projects/{proj_id}/members/{user_id}")
def remove_project_member(proj_id: str, user_id: str):
    conn = get_db_connection()
    cursor = conn.execute(
        "DELETE FROM project_members WHERE project_id = ? AND user_id = ?;",
        (proj_id, user_id)
    )
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"status": "success"}

# Batches
@app.get("/api/projects/{proj_id}/batches")
def get_project_batches(proj_id: str):
    conn = get_db_connection()
    batches = conn.execute("SELECT * FROM batches WHERE project_id = ? ORDER BY created_at DESC;", (proj_id,)).fetchall()
    conn.close()
    return [dict(b) for b in batches]

@app.post("/api/projects/{proj_id}/batches")
def create_project_batch(proj_id: str, batch: BatchCreate):
    conn = get_db_connection()
    batch_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    try:
        conn.execute(
            "INSERT INTO batches (id, project_id, name, created_at) VALUES (?, ?, ?, ?);",
            (batch_id, proj_id, batch.name, now)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    conn.close()
    return {"id": batch_id, "name": batch.name}

@app.delete("/api/batches/{batch_id}")
def delete_batch(batch_id: str):
    conn = get_db_connection()
    cursor = conn.execute("DELETE FROM batches WHERE id = ?;", (batch_id,))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"status": "success"}

# Tasks
@app.get("/api/projects/{proj_id}/tasks")
def get_project_tasks(proj_id: str, stage: Optional[str] = None):
    conn = get_db_connection()
    query = "SELECT * FROM tasks WHERE project_id = ?"
    params = [proj_id]
    if stage:
        query += " AND stage = ?"
        params.append(stage)
    query += " ORDER BY created_at ASC;"
    
    tasks = conn.execute(query, tuple(params)).fetchall()
    conn.close()
    return [dict(t) for t in tasks]

@app.post("/api/projects/{proj_id}/tasks")
def create_project_tasks(proj_id: str, tasks: List[TaskCreate]):
    conn = get_db_connection()
    now = datetime.now().isoformat()
    inserted_tasks = []
    
    try:
        for t in tasks:
            task_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO tasks (id, project_id, batch_id, external_id, media_url, media_type, stage, created_at) 
                   VALUES (?, ?, ?, ?, ?, ?, 'start', ?);""",
                (task_id, proj_id, t.batch_id, t.external_id, t.media_url, t.media_type, now)
            )
            inserted_tasks.append({"id": task_id, "external_id": t.external_id})
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    
    conn.close()
    return {"inserted_count": len(inserted_tasks), "tasks": inserted_tasks}

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    conn = get_db_connection()
    task = conn.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,)).fetchone()
    conn.close()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return dict(task)

@app.put("/api/tasks/{task_id}/stage")
def update_task_stage(task_id: str, stage: str = Body(..., embed=True)):
    conn = get_db_connection()
    cursor = conn.execute("UPDATE tasks SET stage = ? WHERE id = ?;", (stage, task_id))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "success", "stage": stage}

@app.put("/api/tasks/{task_id}/assign")
def assign_task(task_id: str, assignee_id: Optional[str] = Body(None, embed=True)):
    conn = get_db_connection()
    cursor = conn.execute("UPDATE tasks SET assignee_id = ? WHERE id = ?;", (assignee_id, task_id))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "success"}

# Annotations
@app.get("/api/tasks/{task_id}/annotations")
def get_task_annotations(task_id: str):
    conn = get_db_connection()
    annotation = conn.execute("SELECT * FROM annotations WHERE task_id = ?;", (task_id,)).fetchone()
    conn.close()
    if not annotation:
        return {"annotations_data": [], "classifications_data": {}, "relations_data": []}
    
    d = dict(annotation)
    return {
        "annotations_data": json.loads(d['annotations_data']),
        "classifications_data": json.loads(d['classifications_data']),
        "relations_data": json.loads(d['relations_data']),
        "user_id": d['user_id']
    }

@app.post("/api/tasks/{task_id}/annotations")
def save_task_annotations(task_id: str, payload: AnnotationsSave):
    conn = get_db_connection()
    now = datetime.now().isoformat()
    
    # Check if annotation already exists
    existing = conn.execute("SELECT id FROM annotations WHERE task_id = ?;", (task_id,)).fetchone()
    
    try:
        if existing:
            conn.execute(
                """UPDATE annotations 
                   SET annotations_data = ?, classifications_data = ?, relations_data = ?, updated_at = ? 
                   WHERE task_id = ?;""",
                (
                    json.dumps(payload.annotations_data), 
                    json.dumps(payload.classifications_data), 
                    json.dumps(payload.relations_data), 
                    now, 
                    task_id
                )
            )
        else:
            annotation_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO annotations (id, task_id, user_id, annotations_data, classifications_data, relations_data, created_at, updated_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
                (
                    annotation_id, 
                    task_id, 
                    payload.user_id, 
                    json.dumps(payload.annotations_data), 
                    json.dumps(payload.classifications_data), 
                    json.dumps(payload.relations_data), 
                    now, 
                    now
                )
            )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
        
    conn.close()
    return {"status": "success"}

# Issues/Comments
@app.get("/api/tasks/{task_id}/issues")
def get_task_issues(task_id: str):
    conn = get_db_connection()
    issues = conn.execute("""
        SELECT i.*, p.email, p.full_name
        FROM issues i
        JOIN profiles p ON i.created_by = p.id
        WHERE i.task_id = ?
        ORDER BY i.created_at DESC;
    """, (task_id,)).fetchall()
    conn.close()
    return [dict(i) for i in issues]

@app.post("/api/tasks/{task_id}/issues")
def create_task_issue(task_id: str, issue: IssueCreate):
    conn = get_db_connection()
    issue_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    try:
        conn.execute(
            "INSERT INTO issues (id, task_id, comment, status, created_by, created_at) VALUES (?, ?, ?, 'open', ?, ?);",
            (issue_id, task_id, issue.comment, issue.created_by, now)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    conn.close()
    return {"id": issue_id, "comment": issue.comment, "status": "open"}

@app.put("/api/issues/{issue_id}/status")
def update_issue_status(issue_id: str, payload: IssueStatusUpdate):
    conn = get_db_connection()
    cursor = conn.execute("UPDATE issues SET status = ? WHERE id = ?;", (payload.status, issue_id))
    conn.commit()
    conn.close()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"status": "success"}

# Serves static frontend files
# Creates the static directory if it does not exist
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
