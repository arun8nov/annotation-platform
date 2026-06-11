// --- UTILITY: Generate UUID (cross-browser) ---
function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- APPLICATION GLOBAL STATE ---
const State = {
    currentUserId: "usr-1",
    currentUserEmail: "manager@platform.com",
    currentUserRole: "manager", // Default simulation role
    activeProjectId: null,
    activeProject: null,
    activeTaskId: null,
    activeTask: null,
    activeStageFilter: "",
    
    // Loaded Collections
    profiles: [],
    projects: [],
    tasks: [],
    batches: [],
    issues: [],
    
    // Canvas State (Image Annotation)
    canvasScale: 1,
    canvasPanX: 0,
    canvasPanY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    activeTool: 'bbox', // 'bbox', 'polygon', 'polyline', 'point', 'circle'
    activeCategoryId: null, // Selected class id for drawing
    imageNaturalWidth: 1,
    imageNaturalHeight: 1,
    
    // Shapes drawn on active image: Array of { id, type, categoryId, points: [], name, color }
    shapes: [],
    selectedShapeId: null,
    
    // Polygon drawing temporary variables
    tempPoints: [],
    
    // Text Workspace State: Array of { id, start, end, text, categoryId, color, name }
    textHighlights: [],
    selectedHighlightId: null,
    
    // Classifications State: Map of categoryId -> value
    classificationsValues: {}
};

// --- INITIALIZE APP ---
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

async function initApp() {
    // 1. Fetch default profiles to populate simulation dropdown
    await fetchProfiles();
    
    // 2. Set up initial event handlers
    setupNavigation();
    setupSimulator();
    setupProjectCreation();
    setupSchemaConfig();
    setupMembersConfig();
    setupBatchesConfig();
    setupWorkspaceDrawing();
    
    // 3. Trigger initial view
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    
    console.log("App initialized successfully.");
}

// --- FETCH CORE PROFILES ---
async function fetchProfiles() {
    try {
        const res = await fetch("/api/profiles");
        State.profiles = await res.json();
        
        const select = document.getElementById("current-user-select");
        const memberUserSelect = document.getElementById("member-add-user-select");
        
        select.innerHTML = "";
        memberUserSelect.innerHTML = "";
        
        State.profiles.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.full_name} (${p.email})</option>`;
            memberUserSelect.innerHTML += `<option value="${p.id}">${p.full_name}</option>`;
        });
        
        // Select first user as active simulation profile
        if (State.profiles.length > 0) {
            State.currentUserId = State.profiles[0].id;
            State.currentUserEmail = State.profiles[0].email;
            updateSimulatorRole();
        }
    } catch (err) {
        console.error("Failed to fetch user profiles:", err);
    }
}

// Update Active Simulation User Role when swapped
function updateSimulatorRole() {
    const profile = State.profiles.find(p => p.id === State.currentUserId);
    if (!profile) return;
    State.currentUserEmail = profile.email;
    
    // Check if member of project, else fallback to profile baseline
    if (State.activeProjectId) {
        fetchProjectMembers(State.activeProjectId).then(members => {
            const member = members.find(m => m.user_id === State.currentUserId);
            State.currentUserRole = member ? member.role : 'labeler'; // fallback
            renderRoleAccessUI();
        });
    } else {
        // No project context, baseline settings
        State.currentUserRole = (State.currentUserId === "usr-1") ? "manager" : "labeler";
        renderRoleAccessUI();
    }
}

// Adjust UI features visibility based on active role permissions
function renderRoleAccessUI() {
    const role = State.currentUserRole;
    const isManagerOrLead = (role === 'manager' || role === 'lead');
    
    // Display dashboard creator tools
    const createBtn = document.getElementById("btn-create-project");
    if (createBtn) createBtn.style.display = isManagerOrLead ? "flex" : "none";
    
    const uploadBtn = document.getElementById("manager-task-actions");
    if (uploadBtn) uploadBtn.style.display = isManagerOrLead ? "block" : "none";
    
    // Display Project Submenus based on role
    const settingsSchemaMenu = document.querySelector('[data-view="settings-schema"]');
    const settingsMembersMenu = document.querySelector('[data-view="settings-members"]');
    const settingsBatchesMenu = document.querySelector('[data-view="settings-batches"]');
    
    if (settingsSchemaMenu) settingsSchemaMenu.style.display = isManagerOrLead ? "flex" : "none";
    if (settingsMembersMenu) settingsMembersMenu.style.display = (role === 'manager') ? "flex" : "none";
    if (settingsBatchesMenu) settingsBatchesMenu.style.display = isManagerOrLead ? "flex" : "none";
    
    // Workspace Approve/Reject controls (guard against null elements)
    const isReviewerOrLead = (role === 'manager' || role === 'lead' || role === 'reviewer');
    const approveBtn = document.getElementById("btn-workspace-approve");
    const rejectBtn = document.getElementById("btn-workspace-reject");
    if (approveBtn) approveBtn.style.display = isReviewerOrLead ? "block" : "none";
    if (rejectBtn) rejectBtn.style.display = isReviewerOrLead ? "block" : "none";
    
    // Refresh Icons
    lucide.createIcons();
}

// --- SINGLE PAGE ROUTING ---
function setupNavigation() {
    const links = document.querySelectorAll(".nav-item");
    links.forEach(link => {
        link.addEventListener("click", (e) => {
            const targetView = link.getAttribute("data-view");
            if (targetView && State.activeProjectId) {
                // If project active, append project id context to hashes
                window.location.hash = `#${targetView}?project=${State.activeProjectId}`;
            } else if (targetView) {
                window.location.hash = `#${targetView}`;
            }
        });
    });
}

function setupSimulator() {
    const select = document.getElementById("current-user-select");
    select.addEventListener("change", (e) => {
        State.currentUserId = e.target.value;
        updateSimulatorRole();
    });
}

function handleHashChange() {
    const hash = window.location.hash || "#projects";
    const [viewName, queryStr] = hash.split("?");
    const view = viewName.replace("#", "");
    
    const params = new URLSearchParams(queryStr || "");
    const projectId = params.get("project");
    
    if (projectId && projectId !== State.activeProjectId) {
        selectProject(projectId);
    }
    
    showView(view);
}

function showView(view) {
    // Hide all views first
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("hidden"));
    
    // Deactivate all sidebar nav links
    document.querySelectorAll(".nav-item").forEach(link => link.classList.remove("active"));
    
    const targetSection = document.getElementById(`view-${view}`);
    if (targetSection) {
        targetSection.classList.remove("hidden");
    }
    
    const navLink = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navLink) {
        navLink.classList.add("active");
    }
    
    // Load view specific data
    if (view === "projects") {
        loadProjectsDirectory();
    } else if (view === "overview" && State.activeProjectId) {
        loadProjectOverview(State.activeProjectId);
    } else if (view === "tasks" && State.activeProjectId) {
        loadTasksList(State.activeProjectId);
    } else if (view === "issues" && State.activeProjectId) {
        loadProjectIssues(State.activeProjectId);
    } else if (view === "settings-schema" && State.activeProjectId) {
        loadCategorySchema(State.activeProjectId);
    } else if (view === "settings-members" && State.activeProjectId) {
        loadMembersList(State.activeProjectId);
    } else if (view === "settings-batches" && State.activeProjectId) {
        loadBatchesList(State.activeProjectId);
    }
    
    lucide.createIcons();
}

async function selectProject(projectId) {
    State.activeProjectId = projectId;
    
    try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error();
        State.activeProject = await res.json();
        
        // Show project selector and submenus
        document.getElementById("project-selector-container").classList.remove("hidden");
        document.getElementById("project-submenu").classList.remove("hidden");
        
        // Load selector project list
        await loadProjectsSelectDropdown();
        document.getElementById("active-project-select").value = projectId;
        
        updateSimulatorRole();
    } catch (err) {
        console.error("Project lookup failed:", err);
        // Reset Project Context
        State.activeProjectId = null;
        State.activeProject = null;
        document.getElementById("project-selector-container").classList.add("hidden");
        document.getElementById("project-submenu").classList.add("hidden");
        window.location.hash = "#projects";
    }
}

async function loadProjectsSelectDropdown() {
    try {
        const res = await fetch("/api/projects");
        State.projects = await res.json();
        const select = document.getElementById("active-project-select");
        select.innerHTML = '<option value="">Back to Directory...</option>';
        State.projects.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
        
        // Event trigger when selecting direct project from dropdown
        select.onchange = (e) => {
            if (e.target.value === "") {
                State.activeProjectId = null;
                State.activeProject = null;
                document.getElementById("project-selector-container").classList.add("hidden");
                document.getElementById("project-submenu").classList.add("hidden");
                window.location.hash = "#projects";
            } else {
                window.location.hash = `#overview?project=${e.target.value}`;
            }
        };
    } catch (err) {
        console.error(err);
    }
}

// --- PROJECT DIRECTORY LOAD ---
async function loadProjectsDirectory() {
    const grid = document.getElementById("projects-grid");
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading projects...</p></div>';
    
    try {
        const res = await fetch("/api/projects");
        State.projects = await res.json();
        
        if (State.projects.length === 0) {
            grid.innerHTML = `
                <div class="card p-8 text-center w-full" style="grid-column: 1/-1;">
                    <i data-lucide="folder-search" style="width: 48px; height: 48px; color: var(--text-muted); margin: 0 auto 16px auto; display: block;"></i>
                    <h3>No Projects Created</h3>
                    <p class="subtitle mt-2">Get started by creating a new database project.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }
        
        grid.innerHTML = "";
        State.projects.forEach(p => {
            grid.innerHTML += `
                <div class="project-card" onclick="window.location.hash='#overview?project=${p.id}'">
                    <div>
                        <h3>${p.name}</h3>
                        <p>${p.description || 'No description provided.'}</p>
                    </div>
                    <div class="project-card-footer">
                        <span>Created: ${new Date(p.created_at).toLocaleDateString()}</span>
                        <span class="badge blue">${p.category_schema.length} Categories</span>
                    </div>
                </div>
            `;
        });
    } catch (err) {
        grid.innerHTML = `<p class="placeholder-text">Error fetching directory.</p>`;
    }
    lucide.createIcons();
}

// Setup Project Creation Dialog
function setupProjectCreation() {
    const modal = document.getElementById("modal-create-project");
    const openBtn = document.getElementById("btn-create-project");
    const closeBtns = document.querySelectorAll(".btn-close-modal");
    const submitBtn = document.getElementById("btn-modal-create-project-submit");
    
    openBtn.addEventListener("click", () => modal.classList.remove("hidden"));
    closeBtns.forEach(btn => btn.addEventListener("click", () => modal.classList.add("hidden")));
    
    submitBtn.addEventListener("click", async () => {
        const name = document.getElementById("new-project-name").value;
        const desc = document.getElementById("new-project-desc").value;
        
        if (!name) return alert("Project Name is required.");
        
        try {
            const res = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name,
                    description: desc,
                    created_by: State.currentUserId
                })
            });
            
            if (res.ok) {
                const newProj = await res.json();
                modal.classList.add("hidden");
                // Clear inputs
                document.getElementById("new-project-name").value = "";
                document.getElementById("new-project-desc").value = "";
                // Redirect to project dashboard
                window.location.hash = `#overview?project=${newProj.id}`;
            } else {
                alert("Failed to create project.");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

// --- PROJECT OVERVIEW / DASHBOARD ---
async function loadProjectOverview(projectId) {
    try {
        const res = await fetch(`/api/projects/${projectId}`);
        State.activeProject = await res.json();
        
        document.getElementById("overview-project-name").textContent = State.activeProject.name;
        document.getElementById("overview-project-desc").textContent = State.activeProject.description || "No project description.";
        document.getElementById("overview-created-at").textContent = new Date(State.activeProject.created_at).toLocaleString();
        
        // Fetch project manager profile name
        const profilesRes = await fetch("/api/profiles");
        const profiles = await profilesRes.json();
        const manager = profiles.find(p => p.id === State.activeProject.created_by);
        document.getElementById("overview-project-manager").textContent = manager ? manager.full_name : "Unknown Manager";
        
        // Fetch stats counts
        const tasksRes = await fetch(`/api/projects/${projectId}/tasks`);
        const tasks = await tasksRes.json();
        document.getElementById("overview-total-tasks").textContent = tasks.length;
        
        const doneTasks = tasks.filter(t => t.stage === 'complete').length;
        const todoTasks = tasks.filter(t => t.stage === 'label' || t.stage === 'start').length;
        const reviewTasks = tasks.filter(t => t.stage === 'review' || t.stage === 'sqc').length;
        const reviewTodo = tasks.filter(t => t.stage === 'review').length;
        
        document.getElementById("stat-label-done").textContent = doneTasks;
        document.getElementById("stat-label-todo").textContent = todoTasks;
        document.getElementById("stat-review-done").textContent = reviewTasks;
        document.getElementById("stat-review-todo").textContent = reviewTodo;
        
        const batchesRes = await fetch(`/api/projects/${projectId}/batches`);
        const batches = await batchesRes.json();
        document.getElementById("overview-total-batches").textContent = batches.length;
        
        // Start Labeling Button Trigger
        const labelBtn = document.getElementById("overview-start-labeling");
        labelBtn.onclick = () => {
            // Find first incomplete task
            const nextTask = tasks.find(t => t.stage !== 'complete');
            if (nextTask) {
                openWorkspaceTask(nextTask.id);
            } else {
                alert("All tasks are completed in this project!");
            }
        };
    } catch (err) {
        console.error(err);
    }
}

// --- TASKS LIST LOAD & MOCK POPULATOR ---
async function loadTasksList(projectId) {
    const tbody = document.getElementById("tasks-table-body");
    tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text"><div class="spinner" style="margin: 0 auto;"></div></td></tr>';
    
    try {
        const res = await fetch(`/api/projects/${projectId}/tasks?stage=${State.activeStageFilter}`);
        State.tasks = await res.json();
        
        // Fetch all profiles to map assignees
        const profRes = await fetch("/api/profiles");
        const profiles = await profRes.json();
        
        // Load stages filter badges
        await updateTasksStageBadges(projectId);
        
        if (State.tasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text">No tasks available in this project stage.</td></tr>';
            return;
        }
        
        tbody.innerHTML = "";
        State.tasks.forEach(t => {
            const assignee = profiles.find(p => p.id === t.assignee_id);
            const assigneeText = assignee ? assignee.full_name : '<span class="text-muted">Unassigned</span>';
            
            // Map stage colors
            let stageClass = "badge";
            if (t.stage === 'complete') stageClass += " green";
            else if (t.stage === 'review') stageClass += " purple";
            else if (t.stage === 'label') stageClass += " blue";
            else if (t.stage === 'start') stageClass += " orange";
            
            tbody.innerHTML += `
                <tr>
                    <td><code>${t.id.substring(0, 8)}...</code></td>
                    <td><strong>${t.external_id}</strong></td>
                    <td><span class="badge">${t.media_type.toUpperCase()}</span></td>
                    <td><span class="${stageClass}">${t.stage.toUpperCase()}</span></td>
                    <td>${assigneeText}</td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only" onclick="openWorkspaceTask('${t.id}')" title="Annotate Task">
                            <i data-lucide="edit"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text">Error loading tasks.</td></tr>';
    }
}

// Fetch stages counts to update sidebar filter numbers
async function updateTasksStageBadges(projectId) {
    try {
        const res = await fetch(`/api/projects/${projectId}/tasks`);
        const allTasks = await res.json();
        
        document.getElementById("badge-all-stages").textContent = allTasks.length;
        document.getElementById("badge-stage-start").textContent = allTasks.filter(t => t.stage === 'start').length;
        document.getElementById("badge-stage-label").textContent = allTasks.filter(t => t.stage === 'label').length;
        document.getElementById("badge-stage-review").textContent = allTasks.filter(t => t.stage === 'review').length;
        document.getElementById("badge-stage-complete").textContent = allTasks.filter(t => t.stage === 'complete').length;
    } catch (err) {
        console.error(err);
    }
}

// Setup table stage filter clicks
document.querySelectorAll(".stage-filter-item").forEach(item => {
    item.addEventListener("click", () => {
        if (!State.activeProjectId) return; // Guard against null project
        document.querySelectorAll(".stage-filter-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        State.activeStageFilter = item.getAttribute("data-stage");
        loadTasksList(State.activeProjectId);
    });
});

// Setup upload tasks button and modal populator
document.getElementById("btn-upload-tasks").addEventListener("click", async () => {
    const modal = document.getElementById("modal-upload-tasks");
    modal.classList.remove("hidden");
    
    // Fetch project batches to select
    try {
        const res = await fetch(`/api/projects/${State.activeProjectId}/batches`);
        const batches = await res.json();
        const select = document.getElementById("upload-task-batch-select");
        select.innerHTML = '<option value="">No Batch</option>';
        batches.forEach(b => {
            select.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        });
    } catch (err) {
        console.error(err);
    }
});

// Populator submission handler
document.getElementById("btn-modal-upload-tasks-submit").addEventListener("click", async () => {
    const batchId = document.getElementById("upload-task-batch-select").value || null;
    const type = document.querySelector('input[name="mock-dataset-preset"]:checked').value;
    
    let mockTasks = [];
    if (type === "images") {
        mockTasks = [
            {
                external_id: "road-scene-01.jpg",
                media_url: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1280&q=80",
                media_type: "image",
                batch_id: batchId
            },
            {
                external_id: "street-intersection.jpg",
                media_url: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?auto=format&fit=crop&w=1280&q=80",
                media_type: "image",
                batch_id: batchId
            },
            {
                external_id: "highway-delivery-truck.jpg",
                media_url: "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1280&q=80",
                media_type: "image",
                batch_id: batchId
            }
        ];
    } else {
        mockTasks = [
            {
                external_id: "patient-medical-chart-1.txt",
                media_url: "PATIENT DIAGNOSIS REPORT:\nPatient name John Doe, 45 years old, presented with chest pain on 2026-06-10.\nPrescribed Aspirin 81mg once daily and referred to Cardiology clinic in New York.",
                media_type: "text",
                batch_id: batchId
            },
            {
                external_id: "clinical-triage-summary.txt",
                media_url: "TRIAGE SUMMARY:\nAdmitted Sarah Connor to Mercy Hospital. Diagnosed acute appendicitis.\nCompleted emergency laparoscopic appendectomy under general anesthesia.",
                media_type: "text",
                batch_id: batchId
            }
        ];
    }
    
    try {
        const res = await fetch(`/api/projects/${State.activeProjectId}/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mockTasks)
        });
        
        if (res.ok) {
            document.getElementById("modal-upload-tasks").classList.add("hidden");
            loadTasksList(State.activeProjectId);
        } else {
            alert("Failed to upload tasks.");
        }
    } catch (err) {
        console.error(err);
    }
});

// Close modal wrappers
document.querySelectorAll(".btn-close-modal").forEach(btn => {
    btn.addEventListener("click", () => {
        document.getElementById("modal-create-project").classList.add("hidden");
        document.getElementById("modal-upload-tasks").classList.add("hidden");
    });
});

// --- VIEW 4: CATEGORY SCHEMA CONFIG ---
let schemaEditorList = [];

function setupSchemaConfig() {
    const colorDots = document.querySelectorAll(".color-dot");
    let selectedColor = "#EF4444";
    
    colorDots.forEach(dot => {
        dot.addEventListener("click", () => {
            colorDots.forEach(d => d.classList.remove("active"));
            dot.classList.add("active");
            selectedColor = dot.getAttribute("data-color");
        });
    });
    
    // Add Category Button Trigger
    document.getElementById("btn-add-schema-item").addEventListener("click", () => {
        const name = document.getElementById("schema-label-name").value;
        const tool = document.getElementById("schema-label-tool").value;
        const shortcut = document.getElementById("schema-label-shortcut").value;
        
        if (!name) return alert("Category Name is required.");
        
        const newItem = {
            id: "cat-" + generateUUID().substring(0, 8),
            name: name,
            tool: tool,
            color: selectedColor,
            shortcut: shortcut
        };
        
        schemaEditorList.push(newItem);
        document.getElementById("schema-label-name").value = "";
        renderSchemaEditorItems();
    });
    
    // Save Schema Config to Database
    document.getElementById("btn-save-schema").addEventListener("click", async () => {
        try {
            const res = await fetch(`/api/projects/${State.activeProjectId}/schema`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category_schema: schemaEditorList })
            });
            
            if (res.ok) {
                alert("Category Schema configuration saved successfully!");
                loadCategorySchema(State.activeProjectId);
            } else {
                alert("Failed to save schema.");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

async function loadCategorySchema(projectId) {
    try {
        const res = await fetch(`/api/projects/${projectId}`);
        const proj = await res.json();
        schemaEditorList = proj.category_schema || [];
        renderSchemaEditorItems();
    } catch (err) {
        console.error(err);
    }
}

function renderSchemaEditorItems() {
    const container = document.getElementById("schema-items-container");
    container.innerHTML = "";
    
    if (schemaEditorList.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No categories defined yet. Use the sidebar to add your first label.</p>';
        return;
    }
    
    schemaEditorList.forEach((item, index) => {
        container.innerHTML += `
            <div class="schema-item">
                <div class="schema-item-info">
                    <span class="schema-color-swatch" style="background-color: ${item.color};"></span>
                    <span class="schema-item-name">${item.name}</span>
                    <span class="schema-item-tool">${item.tool.toUpperCase()}</span>
                    <span class="schema-item-shortcut">Key ${item.shortcut}</span>
                </div>
                <button class="btn-icon-only text-red-500" onclick="deleteSchemaItem(${index})" title="Remove Category">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
    });
    
    lucide.createIcons();
}

window.deleteSchemaItem = function(index) {
    schemaEditorList.splice(index, 1);
    renderSchemaEditorItems();
};

// --- VIEW 5: MEMBERS & ROLE ACCESS ---
function setupMembersConfig() {
    document.getElementById("btn-add-member").addEventListener("click", async () => {
        const userId = document.getElementById("member-add-user-select").value;
        const role = document.getElementById("member-add-role-select").value;
        
        try {
            const res = await fetch(`/api/projects/${State.activeProjectId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, role: role })
            });
            
            if (res.ok) {
                loadMembersList(State.activeProjectId);
            } else {
                alert("User is already a member of this project.");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

async function fetchProjectMembers(projectId) {
    const res = await fetch(`/api/projects/${projectId}/members`);
    return await res.json();
}

async function loadMembersList(projectId) {
    const tbody = document.getElementById("members-table-body");
    tbody.innerHTML = '<tr><td colspan="4" class="placeholder-text"><div class="spinner" style="margin: 0 auto;"></div></td></tr>';
    
    try {
        const members = await fetchProjectMembers(projectId);
        
        tbody.innerHTML = "";
        members.forEach(m => {
            // Managers cannot delete/modify themselves to avoid locked states
            const isSelf = (m.user_id === State.currentUserId);
            const actionBtns = isSelf ? 'Manager (Self)' : `
                <button class="btn btn-secondary btn-icon-only" onclick="deleteProjectMember('${m.user_id}')" title="Remove Member">
                    <i data-lucide="user-x"></i>
                </button>
            `;
            
            // Render selection role dropdown
            const roles = ['labeler', 'reviewer', 'lead', 'manager'];
            let roleSelect = `<select onchange="updateProjectMemberRole('${m.user_id}', this.value)" class="nav-select" ${isSelf ? 'disabled' : ''}>`;
            roles.forEach(r => {
                roleSelect += `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`;
            });
            roleSelect += "</select>";
            
            tbody.innerHTML += `
                <tr>
                    <td><strong>${m.full_name}</strong></td>
                    <td><code>${m.email}</code></td>
                    <td>${roleSelect}</td>
                    <td>${actionBtns}</td>
                </tr>
            `;
        });
        
        lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" class="placeholder-text">Error loading members.</td></tr>';
    }
}

window.updateProjectMemberRole = async function(userId, newRole) {
    try {
        const res = await fetch(`/api/projects/${State.activeProjectId}/members/${userId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole })
        });
        if (!res.ok) alert("Failed to modify user role.");
    } catch (err) {
        console.error(err);
    }
};

window.deleteProjectMember = async function(userId) {
    if (!confirm("Are you sure you want to remove this user from the project?")) return;
    
    try {
        const res = await fetch(`/api/projects/${State.activeProjectId}/members/${userId}`, {
            method: "DELETE"
        });
        if (res.ok) {
            loadMembersList(State.activeProjectId);
        } else {
            alert("Failed to remove member.");
        }
    } catch (err) {
        console.error(err);
    }
};

// --- VIEW 6: BATCHES ---
function setupBatchesConfig() {
    document.getElementById("btn-create-batch").addEventListener("click", async () => {
        const name = document.getElementById("batch-new-name").value;
        if (!name) return alert("Batch Name is required.");
        
        try {
            const res = await fetch(`/api/projects/${State.activeProjectId}/batches`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name })
            });
            
            if (res.ok) {
                document.getElementById("batch-new-name").value = "";
                loadBatchesList(State.activeProjectId);
            } else {
                alert("Failed to create batch.");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

async function loadBatchesList(projectId) {
    const tbody = document.getElementById("batches-table-body");
    tbody.innerHTML = '<tr><td colspan="3" class="placeholder-text"><div class="spinner" style="margin: 0 auto;"></div></td></tr>';
    
    try {
        const res = await fetch(`/api/projects/${projectId}/batches`);
        State.batches = await res.json();
        
        tbody.innerHTML = "";
        State.batches.forEach(b => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${b.name}</strong></td>
                    <td><code>${b.id}</code></td>
                    <td>
                        <button class="btn btn-secondary btn-icon-only text-red-500" onclick="deleteBatch('${b.id}')" title="Delete Batch">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="3" class="placeholder-text">Error loading batches.</td></tr>';
    }
}

window.deleteBatch = async function(batchId) {
    if (!confirm("Deleting this batch will un-associate all its tasks. Continue?")) return;
    
    try {
        const res = await fetch(`/api/batches/${batchId}`, {
            method: "DELETE"
        });
        if (res.ok) {
            loadBatchesList(State.activeProjectId);
        } else {
            alert("Failed to delete batch.");
        }
    } catch (err) {
        console.error(err);
    }
};

// --- VIEW 7: ISSUES LOG ---
async function loadProjectIssues(projectId) {
    const tbody = document.getElementById("issues-table-body");
    tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text"><div class="spinner" style="margin: 0 auto;"></div></td></tr>';
    
    try {
        // Find tasks in this project
        const tasksRes = await fetch(`/api/projects/${projectId}/tasks`);
        const tasks = await tasksRes.json();
        
        tbody.innerHTML = "";
        let issuesFound = 0;
        
        for (const t of tasks) {
            const res = await fetch(`/api/tasks/${t.id}/issues`);
            const issues = await res.json();
            
            issues.forEach(i => {
                issuesFound++;
                const statusBadge = i.status === 'open' ? '<span class="badge red">OPEN</span>' : '<span class="badge green">RESOLVED</span>';
                const resolveBtn = i.status === 'open' ? `
                    <button class="btn btn-secondary btn-icon-only text-green-500" onclick="resolveIssue('${i.id}')" title="Mark Resolved">
                        <i data-lucide="check"></i>
                    </button>
                ` : '<span class="text-muted">-</span>';
                
                tbody.innerHTML += `
                    <tr>
                        <td><code>${i.task_id.substring(0, 8)}...</code></td>
                        <td><strong>${i.comment}</strong></td>
                        <td>${statusBadge}</td>
                        <td>${i.full_name}</td>
                        <td>${new Date(i.created_at).toLocaleString()}</td>
                        <td>${resolveBtn}</td>
                    </tr>
                `;
            });
        }
        
        // Update Sidebar Counter badge
        const badge = document.getElementById("open-issues-count");
        if (issuesFound > 0) {
            badge.textContent = issuesFound;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
        
        if (issuesFound === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text">No QA issues filed on this project.</td></tr>';
        }
        
        lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text">Error loading project issues.</td></tr>';
    }
}

window.resolveIssue = async function(issueId) {
    try {
        const res = await fetch(`/api/issues/${issueId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "resolved" })
        });
        if (res.ok) {
            loadProjectIssues(State.activeProjectId);
        } else {
            alert("Failed to resolve issue.");
        }
    } catch (err) {
        console.error(err);
    }
};

// --- VIEW 8: ANNOTATION WORKSPACE CODE ---
window.openWorkspaceTask = async function(taskId) {
    State.activeTaskId = taskId;
    window.location.hash = `#workspace?project=${State.activeProjectId}`;
    
    // Switch views manually for speed
    showView("workspace");
    
    // Load workspace task metadata
    try {
        const res = await fetch(`/api/tasks/${taskId}`);
        State.activeTask = await res.json();
        
        // Setup header badges
        document.getElementById("workspace-task-id-badge").textContent = `Task: ${State.activeTask.id.substring(0, 8)}...`;
        document.getElementById("workspace-task-type-badge").textContent = State.activeTask.media_type.toUpperCase();
        document.getElementById("workspace-task-stage-badge").textContent = State.activeTask.stage.toUpperCase();
        
        // 1. Render Workspace Category Labels Sidebar
        renderWorkspaceLabels();
        
        // 2. Load Existing Annotations from DB
        await loadAnnotations(taskId);
        
        // 3. Load Active Media Viewport
        if (State.activeTask.media_type === "image") {
            document.getElementById("image-viewport-container").classList.remove("hidden");
            document.getElementById("text-viewport-container").classList.add("hidden");
            document.getElementById("image-drawing-toolbar").classList.remove("hidden");
            document.getElementById("text-drawing-toolbar").classList.add("hidden");
            
            // Load drawing canvas viewport
            loadCanvasImage(State.activeTask.media_url);
        } else {
            document.getElementById("image-viewport-container").classList.add("hidden");
            document.getElementById("text-viewport-container").classList.remove("hidden");
            document.getElementById("image-drawing-toolbar").classList.add("hidden");
            document.getElementById("text-drawing-toolbar").classList.remove("hidden");
            
            // Load text NER viewport
            loadTextContent(State.activeTask.media_url);
        }
        
        // Load task issues log
        loadTaskWorkspaceIssues(taskId);
        
    } catch (err) {
        console.error(err);
        alert("Failed to load workspace task.");
        window.location.hash = `#tasks?project=${State.activeProjectId}`;
    }
};

// Return to tasks list button
document.getElementById("workspace-back-btn").addEventListener("click", () => {
    window.location.hash = `#tasks?project=${State.activeProjectId}`;
});

// Render right sidebar categories select
function renderWorkspaceLabels() {
    const container = document.getElementById("workspace-labels-selector");
    container.innerHTML = "";
    
    const schema = State.activeProject.category_schema || [];
    
    // Render only drawing labels or NER labels based on active workspace mode
    const drawingTools = ['bbox', 'polygon', 'polyline', 'point', 'circle'];
    const activeType = State.activeTask.media_type;
    
    const filteredSchema = schema.filter(item => {
        if (activeType === "image") return drawingTools.includes(item.tool);
        return item.tool === "ner";
    });
    
    if (filteredSchema.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No drawing/NER classes defined.</p>';
        return;
    }
    
    // Select first category as active automatically
    State.activeCategoryId = filteredSchema[0].id;
    if (activeType === "image") {
        State.activeTool = filteredSchema[0].tool;
        updateActiveDrawingToolBtn();
    }
    
    filteredSchema.forEach(item => {
        const isActive = (item.id === State.activeCategoryId);
        container.innerHTML += `
            <button class="label-selector-btn ${isActive ? 'active' : ''}" 
                    data-cat-id="${item.id}" 
                    data-tool="${item.tool}"
                    onclick="selectWorkspaceCategory('${item.id}', '${item.tool}')">
                <span class="label-indicator">
                    <span class="label-color-dot" style="background-color: ${item.color};"></span>
                    <span>${item.name}</span>
                </span>
                <span class="shortcut">Key ${item.shortcut}</span>
            </button>
        `;
    });
    
    // Render custom classification forms in sidebar (Radios, Checkboxes, Text)
    renderClassificationsForms();
}

window.selectWorkspaceCategory = function(catId, tool) {
    State.activeCategoryId = catId;
    State.activeTool = tool;
    
    // Update active UI classes
    document.querySelectorAll(".label-selector-btn").forEach(btn => {
        if (btn.getAttribute("data-cat-id") === catId) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    
    updateActiveDrawingToolBtn();
};

function updateActiveDrawingToolBtn() {
    document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
        if (btn.getAttribute("data-tool") === State.activeTool) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

// Global Hotkeys handler (1-9 numeric triggers)
window.addEventListener("keydown", (e) => {
    // Only capture shortcut triggers if workspace is active and not inside inputs
    if (window.location.hash.indexOf("#workspace") === -1) return;
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "SELECT") return;
    
    const key = e.key;
    const schema = State.activeProject.category_schema || [];
    
    if (key >= "1" && key <= "9") {
        const match = schema.find(item => item.shortcut === key);
        if (match) {
            selectWorkspaceCategory(match.id, match.tool);
        }
    }
    
    // Drawing quick tools keyboard shortcuts
    if (State.activeTask && State.activeTask.media_type === "image") {
        if (key.toLowerCase() === "b") selectDrawingTool("bbox");
        if (key.toLowerCase() === "p") selectDrawingTool("polygon");
        if (key.toLowerCase() === "l") selectDrawingTool("polyline");
        if (key.toLowerCase() === "k") selectDrawingTool("point");
        if (key.toLowerCase() === "c") selectDrawingTool("circle");
    }
});

function selectDrawingTool(tool) {
    // Find first category matching this tool
    const schema = State.activeProject.category_schema || [];
    const match = schema.find(item => item.tool === tool);
    if (match) {
        selectWorkspaceCategory(match.id, tool);
    } else {
        State.activeTool = tool;
        updateActiveDrawingToolBtn();
    }
}

// Toolbtns Event Listeners
document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
        selectDrawingTool(btn.getAttribute("data-tool"));
    });
});

// --- RENDER DYNAMIC CLASSIFICATION FORM SIDEBAR ---
function renderClassificationsForms() {
    const container = document.getElementById("workspace-classifications-form");
    container.innerHTML = "";
    
    const schema = State.activeProject.category_schema || [];
    const classificationItems = schema.filter(item => ['radio', 'checkbox', 'text'].includes(item.tool));
    
    if (classificationItems.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No active attribute forms configured.</p>';
        return;
    }
    
    classificationItems.forEach(item => {
        const val = State.classificationsValues[item.id] || "";
        
        let html = `<div class="form-group" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px; margin-bottom: 12px;">`;
        html += `<label><strong>${item.name}</strong></label>`;
        
        if (item.tool === 'text') {
            html += `<input type="text" value="${val}" oninput="updateClassificationValue('${item.id}', this.value)" placeholder="Enter transcription/notes..." style="font-size: 12px; padding: 6px 10px; width: 100%;">`;
        } else if (item.tool === 'radio') {
            html += `
                <div class="mt-2 flex flex-col gap-2">
                    <label class="radio-label">
                        <input type="radio" name="class-${item.id}" value="yes" ${val === 'yes' ? 'checked' : ''} onchange="updateClassificationValue('${item.id}', 'yes')">
                        <span>Yes</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="class-${item.id}" value="no" ${val === 'no' ? 'checked' : ''} onchange="updateClassificationValue('${item.id}', 'no')">
                        <span>No</span>
                    </label>
                </div>
            `;
        } else if (item.tool === 'checkbox') {
            // Checkbox multi values stored as array in JSON
            const activeList = Array.isArray(val) ? val : [];
            html += `
                <div class="mt-2 flex flex-col gap-2">
                    <label class="radio-label">
                        <input type="checkbox" name="class-${item.id}" value="flagged" ${activeList.includes('flagged') ? 'checked' : ''} onchange="updateCheckboxValue('${item.id}', 'flagged', this.checked)">
                        <span>Flagged / Quality Issue</span>
                    </label>
                    <label class="radio-label">
                        <input type="checkbox" name="class-${item.id}" value="verified" ${activeList.includes('verified') ? 'checked' : ''} onchange="updateCheckboxValue('${item.id}', 'verified', this.checked)">
                        <span>Verified Gold Standard</span>
                    </label>
                </div>
            `;
        }
        
        html += "</div>";
        container.innerHTML += html;
    });
}

window.updateClassificationValue = function(catId, value) {
    State.classificationsValues[catId] = value;
};

window.updateCheckboxValue = function(catId, flag, isChecked) {
    let list = State.classificationsValues[catId] || [];
    if (!Array.isArray(list)) list = [];
    
    if (isChecked) {
        if (!list.includes(flag)) list.push(flag);
    } else {
        list = list.filter(item => item !== flag);
    }
    State.classificationsValues[catId] = list;
};

// --- A. IMAGE WORKSPACE: SVG VECTOR DRAWING ENGINE ---
function loadCanvasImage(url) {
    const img = document.getElementById("workspace-image");
    img.src = url;
    
    img.onload = () => {
        State.imageNaturalWidth = img.naturalWidth;
        State.imageNaturalHeight = img.naturalHeight;
        
        // Match SVG viewport overlay boundaries to match natural image size scale
        const svg = document.getElementById("canvas-svg");
        svg.setAttribute("viewBox", `0 0 ${State.imageNaturalWidth} ${State.imageNaturalHeight}`);
        
        // Reset scale zoom levels and coordinates offset
        State.canvasScale = 1;
        State.canvasPanX = 0;
        State.canvasPanY = 0;
        applyCanvasViewportTransforms();
        
        // Render shapes in vector groups
        renderSVGElements();
    };
}

function applyCanvasViewportTransforms() {
    const wrapper = document.getElementById("canvas-pan-zoom-container");
    wrapper.style.transform = `translate(${State.canvasPanX}px, ${State.canvasPanY}px) scale(${State.canvasScale})`;
}

// Zoom Pan Controls
function setupWorkspaceDrawing() {
    const viewport = document.querySelector(".workspace-viewport");
    
    document.getElementById("canvas-zoom-in").addEventListener("click", () => {
        State.canvasScale = Math.min(State.canvasScale * 1.25, 8);
        applyCanvasViewportTransforms();
    });
    
    document.getElementById("canvas-zoom-out").addEventListener("click", () => {
        State.canvasScale = Math.max(State.canvasScale / 1.25, 0.25);
        applyCanvasViewportTransforms();
    });
    
    document.getElementById("canvas-reset").addEventListener("click", () => {
        State.canvasScale = 1;
        State.canvasPanX = 0;
        State.canvasPanY = 0;
        applyCanvasViewportTransforms();
    });
    
    // Middle-click / Space+drag to Pan viewport image
    viewport.addEventListener("mousedown", (e) => {
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            State.isPanning = true;
            State.panStartX = e.clientX - State.canvasPanX;
            State.panStartY = e.clientY - State.canvasPanY;
            viewport.style.cursor = "grabbing";
        }
    });
    
    viewport.addEventListener("mousemove", (e) => {
        if (State.isPanning) {
            State.canvasPanX = e.clientX - State.panStartX;
            State.canvasPanY = e.clientY - State.panStartY;
            applyCanvasViewportTransforms();
        }
    });
    
    window.addEventListener("mouseup", () => {
        if (State.isPanning) {
            State.isPanning = false;
            viewport.style.cursor = "default";
        }
    });
    
    // Disable right click menu inside canvas
    viewport.addEventListener("contextmenu", e => e.preventDefault());
    
    // Draw Shapes logic inside SVG
    const svg = document.getElementById("canvas-svg");
    let isDrawing = false;
    let drawStartPos = { x: 0, y: 0 };
    
    // Get mouse coordinates relative to SVG natural coordinate viewports
    function getSVGCoords(e) {
        const rect = svg.getBoundingClientRect();
        
        // Calculate coordinate positions adjusted for panning offset and zoom scale variables
        const x = (e.clientX - rect.left) * (State.imageNaturalWidth / rect.width);
        const y = (e.clientY - rect.top) * (State.imageNaturalHeight / rect.height);
        
        return { x: Math.round(x), y: Math.round(y) };
    }
    
    svg.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // Only process left click drawing
        if (!State.activeCategoryId) return alert("Select a category class from the sidebar first.");
        
        const pos = getSVGCoords(e);
        const activeCategory = State.activeProject.category_schema.find(c => c.id === State.activeCategoryId);
        
        if (State.activeTool === 'bbox') {
            isDrawing = true;
            drawStartPos = pos;
            
            // Add temp shape outline
            const tempGroup = document.getElementById("svg-temp-group");
            tempGroup.innerHTML = `<rect id="temp-draw-rect" x="${pos.x}" y="${pos.y}" width="0" height="0" stroke="${activeCategory.color}" stroke-width="2" fill="transparent"></rect>`;
        } else if (State.activeTool === 'point') {
            // Point triggers immediately
            const newShape = {
                id: "shp-" + generateUUID().substring(0, 8),
                type: 'point',
                categoryId: State.activeCategoryId,
                points: [{ x: pos.x, y: pos.y }],
                name: activeCategory.name,
                color: activeCategory.color
            };
            State.shapes.push(newShape);
            renderSVGElements();
            renderAnnotationsList();
        } else if (State.activeTool === 'circle') {
            isDrawing = true;
            drawStartPos = pos;
            
            // Add temp shape outline
            const tempGroup = document.getElementById("svg-temp-group");
            tempGroup.innerHTML = `<circle id="temp-draw-circle" cx="${pos.x}" cy="${pos.y}" r="0" stroke="${activeCategory.color}" stroke-width="2" fill="transparent"></circle>`;
        } else if (State.activeTool === 'polygon' || State.activeTool === 'polyline') {
            // Polygon & Polyline work by clicking sequences
            State.tempPoints.push({ x: pos.x, y: pos.y });
            renderTempVectorLine();
        }
    });
    
    svg.addEventListener("mousemove", (e) => {
        if (!isDrawing) return;
        const pos = getSVGCoords(e);
        
        if (State.activeTool === 'bbox') {
            const rect = document.getElementById("temp-draw-rect");
            if (rect) {
                const x = Math.min(pos.x, drawStartPos.x);
                const y = Math.min(pos.y, drawStartPos.y);
                const w = Math.abs(pos.x - drawStartPos.x);
                const h = Math.abs(pos.y - drawStartPos.y);
                
                rect.setAttribute("x", x);
                rect.setAttribute("y", y);
                rect.setAttribute("width", w);
                rect.setAttribute("height", h);
            }
        } else if (State.activeTool === 'circle') {
            const circle = document.getElementById("temp-draw-circle");
            if (circle) {
                // Calculate radius distance (Pythagorean)
                const r = Math.round(Math.sqrt(Math.pow(pos.x - drawStartPos.x, 2) + Math.pow(pos.y - drawStartPos.y, 2)));
                circle.setAttribute("r", r);
            }
        }
    });
    
    svg.addEventListener("mouseup", (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const pos = getSVGCoords(e);
        const activeCategory = State.activeProject.category_schema.find(c => c.id === State.activeCategoryId);
        
        document.getElementById("svg-temp-group").innerHTML = "";
        
        if (State.activeTool === 'bbox') {
            const w = Math.abs(pos.x - drawStartPos.x);
            const h = Math.abs(pos.y - drawStartPos.y);
            
            // Skip tiny drawings to avoid misclicks
            if (w < 5 || h < 5) return;
            
            const newShape = {
                id: "shp-" + generateUUID().substring(0, 8),
                type: 'bbox',
                categoryId: State.activeCategoryId,
                points: [
                    { x: Math.min(pos.x, drawStartPos.x), y: Math.min(pos.y, drawStartPos.y) },
                    { x: Math.max(pos.x, drawStartPos.x), y: Math.max(pos.y, drawStartPos.y) }
                ],
                name: activeCategory.name,
                color: activeCategory.color
            };
            State.shapes.push(newShape);
            renderSVGElements();
            renderAnnotationsList();
        } else if (State.activeTool === 'circle') {
            const r = Math.round(Math.sqrt(Math.pow(pos.x - drawStartPos.x, 2) + Math.pow(pos.y - drawStartPos.y, 2)));
            if (r < 4) return;
            
            const newShape = {
                id: "shp-" + generateUUID().substring(0, 8),
                type: 'circle',
                categoryId: State.activeCategoryId,
                points: [{ x: drawStartPos.x, y: drawStartPos.y }, { x: pos.x, y: pos.y }], // center + radius points
                name: activeCategory.name,
                color: activeCategory.color
            };
            State.shapes.push(newShape);
            renderSVGElements();
            renderAnnotationsList();
        }
    });
    
    // Double click to close polygon path
    svg.addEventListener("dblclick", (e) => {
        if (State.activeTool !== 'polygon' && State.activeTool !== 'polyline') return;
        if (State.tempPoints.length < 2) return;
        
        const activeCategory = State.activeProject.category_schema.find(c => c.id === State.activeCategoryId);
        
        const newShape = {
            id: "shp-" + generateUUID().substring(0, 8),
            type: State.activeTool,
            categoryId: State.activeCategoryId,
            points: [...State.tempPoints],
            name: activeCategory.name,
            color: activeCategory.color
        };
        
        State.shapes.push(newShape);
        State.tempPoints = [];
        document.getElementById("svg-temp-group").innerHTML = "";
        
        renderSVGElements();
        renderAnnotationsList();
    });
}

// Render temporary lines during polygon path construction
function renderTempVectorLine() {
    const tempGroup = document.getElementById("svg-temp-group");
    const activeCategory = State.activeProject.category_schema.find(c => c.id === State.activeCategoryId);
    
    if (State.tempPoints.length === 0) return;
    
    let path = `M ${State.tempPoints[0].x} ${State.tempPoints[0].y}`;
    for (let i = 1; i < State.tempPoints.length; i++) {
        path += ` L ${State.tempPoints[i].x} ${State.tempPoints[i].y}`;
    }
    
    let dotCircles = "";
    State.tempPoints.forEach(p => {
        dotCircles += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#ffffff" stroke="${activeCategory.color}" stroke-width="1.5"></circle>`;
    });
    
    tempGroup.innerHTML = `
        <path d="${path}" stroke="${activeCategory.color}" stroke-width="2" stroke-dasharray="4" fill="transparent"></path>
        ${dotCircles}
    `;
}

// Render active saved vectors into DOM SVG overlay
function renderSVGElements() {
    const group = document.getElementById("svg-shapes-group");
    group.innerHTML = "";
    
    State.shapes.forEach(shp => {
        const isSelected = (shp.id === State.selectedShapeId);
        const activeClass = isSelected ? "selected" : "";
        
        if (shp.type === "bbox") {
            const x1 = shp.points[0].x;
            const y1 = shp.points[0].y;
            const x2 = shp.points[1].x;
            const y2 = shp.points[1].y;
            
            group.innerHTML += `
                <rect class="${activeClass}" data-shp-id="${shp.id}" 
                      x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" 
                      stroke="${shp.color}" fill="transparent"
                      onclick="selectShape('${shp.id}', event)">
                </rect>
            `;
        } else if (shp.type === "circle") {
            const cx = shp.points[0].x;
            const cy = shp.points[0].y;
            // Radius distance calculated on natural image coordinates
            const rx = shp.points[1].x;
            const ry = shp.points[1].y;
            const r = Math.round(Math.sqrt(Math.pow(rx - cx, 2) + Math.pow(ry - cy, 2)));
            
            group.innerHTML += `
                <circle class="${activeClass}" data-shp-id="${shp.id}"
                        cx="${cx}" cy="${cy}" r="${r}"
                        stroke="${shp.color}" fill="transparent"
                        onclick="selectShape('${shp.id}', event)">
                </circle>
            `;
        } else if (shp.type === "point") {
            const p = shp.points[0];
            group.innerHTML += `
                <circle class="${activeClass}" data-shp-id="${shp.id}"
                        cx="${p.x}" cy="${p.y}" r="6"
                        fill="${shp.color}" stroke="#ffffff" stroke-width="1.5"
                        onclick="selectShape('${shp.id}', event)">
                </circle>
            `;
        } else if (shp.type === "polygon") {
            let pts = shp.points.map(p => `${p.x},${p.y}`).join(" ");
            group.innerHTML += `
                <polygon class="${activeClass}" data-shp-id="${shp.id}"
                         points="${pts}"
                         stroke="${shp.color}" fill="transparent"
                         onclick="selectShape('${shp.id}', event)">
                </polygon>
            `;
        } else if (shp.type === "polyline") {
            let pts = shp.points.map(p => `${p.x},${p.y}`).join(" ");
            group.innerHTML += `
                <polyline class="${activeClass}" data-shp-id="${shp.id}"
                         points="${pts}"
                         stroke="${shp.color}" fill="transparent"
                         onclick="selectShape('${shp.id}', event)">
                </polyline>
            `;
        }
    });
}

window.selectShape = function(shapeId, event) {
    if (event) event.stopPropagation();
    State.selectedShapeId = shapeId;
    renderSVGElements();
    renderAnnotationsList();
};

// Render annotations list inside sidebar panel
function renderAnnotationsList() {
    const container = document.getElementById("annotations-list");
    container.innerHTML = "";
    
    const list = (State.activeTask && State.activeTask.media_type === "image") ? State.shapes : State.textHighlights;
    
    if (list.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No annotations created yet.</p>';
        return;
    }
    
    list.forEach(item => {
        const isSelected = (item.id === State.selectedShapeId);
        const typeLabel = item.type ? item.type.toUpperCase() : "SPAN";
        
        container.innerHTML += `
            <div class="annotation-list-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectAnnotationItem('${item.id}', event)">
                <div class="annotation-list-item-left">
                    <span class="schema-color-swatch" style="background-color: ${item.color};"></span>
                    <strong>${item.name}</strong>
                    <span class="badge">${typeLabel}</span>
                </div>
                <button class="delete-btn" onclick="deleteAnnotationItem('${item.id}', event)" title="Delete Annotation">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
    });
    
    lucide.createIcons();
}

window.selectAnnotationItem = function(id, event) {
    if (event) event.stopPropagation();
    State.selectedShapeId = id;
    
    if (State.activeTask.media_type === "image") {
        renderSVGElements();
    } else {
        // Highlight active text span
        document.querySelectorAll(".ner-span").forEach(span => {
            if (span.getAttribute("data-span-id") === id) {
                span.style.boxShadow = "0 0 10px rgba(59, 130, 246, 0.8)";
            } else {
                span.style.boxShadow = "none";
            }
        });
    }
    
    renderAnnotationsList();
};

window.deleteAnnotationItem = function(id, event) {
    if (event) event.stopPropagation();
    
    if (State.activeTask.media_type === "image") {
        State.shapes = State.shapes.filter(s => s.id !== id);
        if (State.selectedShapeId === id) State.selectedShapeId = null;
        renderSVGElements();
    } else {
        State.textHighlights = State.textHighlights.filter(h => h.id !== id);
        if (State.selectedShapeId === id) State.selectedShapeId = null;
        renderTextSpans();
    }
    renderAnnotationsList();
};

// --- B. TEXT WORKSPACE: RICH NER HIGHLIGHTING ENGINE ---
function loadTextContent(text) {
    // Save raw text data
    State.textRaw = text;
    renderTextSpans();
}

// Convert selections into highlights ranges
function setupTextSelectionListener() {
    const el = document.getElementById("text-workspace-content");
    
    el.addEventListener("mouseup", () => {
        const sel = window.getSelection();
        if (sel.isCollapsed) return; // Empty selection range
        
        const range = sel.getRangeAt(0);
        
        // Find selected index position offsets relative to text Raw content
        // To handle simple offset calculations reliably in a local DOM, we match highlighted text spans directly
        const rawContent = el.innerText;
        const selectedText = sel.toString();
        
        const startIndex = rawContent.indexOf(selectedText);
        if (startIndex === -1 || !State.activeCategoryId) return;
        
        const endIndex = startIndex + selectedText.length;
        
        const activeCategory = State.activeProject.category_schema.find(c => c.id === State.activeCategoryId);
        
        // Ensure no overlapping highlights
        const overlaps = State.textHighlights.some(h => {
            return (startIndex >= h.start && startIndex < h.end) || (endIndex > h.start && endIndex <= h.end);
        });
        
        if (overlaps) {
            alert("Annotations overlap! Clear existing span first.");
            sel.removeAllRanges();
            return;
        }
        
        const newHighlight = {
            id: "hl-" + generateUUID().substring(0, 8),
            start: startIndex,
            end: endIndex,
            text: selectedText,
            categoryId: State.activeCategoryId,
            color: activeCategory.color,
            name: activeCategory.name
        };
        
        State.textHighlights.push(newHighlight);
        sel.removeAllRanges();
        
        renderTextSpans();
        renderAnnotationsList();
    });
}

// Run text selection once
setupTextSelectionListener();

// Render highlights inline directly inside html text
function renderTextSpans() {
    const el = document.getElementById("text-workspace-content");
    let text = State.textRaw;
    
    if (State.textHighlights.length === 0) {
        el.innerText = text;
        return;
    }
    
    // Sort highlights backwards to replace slices safely without invalidating offsets
    const sorted = [...State.textHighlights].sort((a, b) => b.start - a.start);
    
    sorted.forEach(hl => {
        const before = text.substring(0, hl.start);
        const highlighted = text.substring(hl.start, hl.end);
        const after = text.substring(hl.end);
        
        text = before + `<span class="ner-span" data-span-id="${hl.id}" style="background-color: ${hl.color}33; border-color: ${hl.color}; border-bottom-width: 2px;">` + 
               highlighted + 
               `<span class="ner-span-label" style="background-color: ${hl.color};">${hl.name}</span>` +
               `<span class="ner-span-remove" onclick="deleteAnnotationItem('${hl.id}', event)">x</span>` +
               `</span>` + after;
    });
    
    el.innerHTML = text;
}

// --- SAVE, SUBMIT, APPROVE, REJECT CONTROLS ---

// Save / Submit Annotations back to API
document.getElementById("btn-workspace-submit").addEventListener("click", async () => {
    await saveActiveAnnotations();
    
    // Auto-advance task stage to review
    await updateTaskStage(State.activeTaskId, "review");
    
    alert("Task submitted successfully! Routing to review queue.");
    window.location.hash = `#tasks?project=${State.activeProjectId}`;
});

document.getElementById("btn-workspace-approve").addEventListener("click", async () => {
    await saveActiveAnnotations();
    await updateTaskStage(State.activeTaskId, "complete");
    alert("Task approved and marked COMPLETE.");
    window.location.hash = `#tasks?project=${State.activeProjectId}`;
});

document.getElementById("btn-workspace-reject").addEventListener("click", async () => {
    await saveActiveAnnotations();
    await updateTaskStage(State.activeTaskId, "label"); // Reject back to labeling
    alert("Task rejected and sent back to label queue.");
    window.location.hash = `#tasks?project=${State.activeProjectId}`;
});

async function saveActiveAnnotations() {
    if (!State.activeTaskId) return;
    
    // Use the correct annotation list based on media type
    const annotationsList = (State.activeTask && State.activeTask.media_type === "text") 
        ? State.textHighlights 
        : State.shapes;
    
    try {
        await fetch(`/api/tasks/${State.activeTaskId}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: State.currentUserId,
                annotations_data: annotationsList,
                classifications_data: State.classificationsValues,
                relations_data: [] // relationships data integration
            })
        });
    } catch (err) {
        console.error("Failed to save annotations:", err);
    }
}

async function updateTaskStage(taskId, newStage) {
    try {
        await fetch(`/api/tasks/${taskId}/stage`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: newStage })
        });
    } catch (err) {
        console.error(err);
    }
}

async function loadAnnotations(taskId) {
    try {
        const res = await fetch(`/api/tasks/${taskId}/annotations`);
        const data = await res.json();
        
        // Load annotations into the correct list based on media type
        if (State.activeTask && State.activeTask.media_type === "text") {
            State.textHighlights = data.annotations_data || [];
            State.shapes = []; // Clear image shapes
        } else {
            State.shapes = data.annotations_data || [];
            State.textHighlights = []; // Clear text highlights
        }
        State.classificationsValues = data.classifications_data || {};
        State.selectedShapeId = null;
        
        // Refresh classifications panel UI
        renderClassificationsForms();
        renderAnnotationsList();
    } catch (err) {
        console.error("Failed to load annotations:", err);
    }
}

// --- TASK QA COMMENTS & ISSUES LOG ---
async function loadTaskWorkspaceIssues(taskId) {
    const container = document.getElementById("workspace-issues-log");
    container.innerHTML = "";
    
    try {
        const res = await fetch(`/api/tasks/${taskId}/issues`);
        const issues = await res.json();
        
        if (issues.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No issues flagged.</p>';
            return;
        }
        
        issues.forEach(i => {
            container.innerHTML += `
                <div class="workspace-issue-item">
                    <p><strong>${i.comment}</strong></p>
                    <div class="meta">
                        <span>by ${i.full_name}</span>
                        <span>${new Date(i.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        });
    } catch (err) {
        console.error(err);
    }
}

// Add issue trigger
document.getElementById("btn-workspace-add-issue").addEventListener("click", async () => {
    const input = document.getElementById("workspace-new-issue-input");
    const comment = input.value;
    if (!comment) return;
    
    try {
        const res = await fetch(`/api/tasks/${State.activeTaskId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                comment: comment,
                created_by: State.currentUserId
            })
        });
        
        if (res.ok) {
            input.value = "";
            loadTaskWorkspaceIssues(State.activeTaskId);
        } else {
            alert("Failed to submit comment.");
        }
    } catch (err) {
        console.error(err);
    }
});
