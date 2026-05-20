// Task Manager
(function() {
    'use strict';

    const STATUSES = ['pending', 'processing', 'done'];

    let tasks = [];
    let allTasks = []; // unfiltered, for computing slider range
    let currentFilter = { start: null, end: null };
    let selectedTaskId = null;
    let dragData = null;
    let peers = { self: null, peers: [] };
    let selectedPeerId = null;
    let sliderData = { dragging: null, minDate: null, maxDate: null };

    // --- API ---
    async function apiGet(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        return res.json();
    }
    async function apiSend(method, url, data) {
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(res.status);
        return res.json();
    }
    const apiPost = (u, d) => apiSend('POST', u, d);
    const apiPut = (u, d) => apiSend('PUT', u, d);
    const apiPatch = (u, d) => apiSend('PATCH', u, d);

    // --- DOM ---
    const $ = id => document.getElementById(id);
    const els = {
        gridBody: $('grid-body'),
        fullscreenBtn: $('fullscreen-btn'),
        sliderTrack: $('slider-track'), sliderRange: $('slider-range'),
        handleStart: $('handle-start'), handleEnd: $('handle-end'),
        labelStart: $('label-start'), labelEnd: $('label-end'),
        addTaskBtn: $('add-task-btn'),
        addTaskModal: $('add-task-modal'), addTaskForm: $('add-task-form'),
        taskName: $('task-name'), taskDesc: $('task-description'),
        taskDeadline: $('task-deadline'), taskPriority: $('task-priority'),
        taskType: $('task-type'), taskCommand: $('task-command'),
        tabNormal: $('tab-normal'), tabScript: $('tab-script'),
        taskAssign: $('task-assign'), taskAssignTrigger: $('task-assign-trigger'), taskAssignDrop: $('task-assign-drop'),
        cancelAdd: $('cancel-add'),
        detailModal: $('task-detail-modal'), detailTitle: $('detail-title'),
        detailContent: $('task-detail-content'),
        editTaskBtn: $('edit-task-btn'), deleteTaskBtn: $('delete-task-btn'),
        closeDetail: $('close-detail'),
        editModal: $('edit-task-modal'), editForm: $('edit-task-form'),
        editName: $('edit-task-name'), editDesc: $('edit-task-description'),
        editDeadline: $('edit-task-deadline'), editPriority: $('edit-task-priority'),
        cancelEdit: $('cancel-edit'),
        fullscreen: $('fullscreen-overlay'), fullscreenContent: $('fullscreen-content'),
        closeFullscreen: $('close-fullscreen'),
        peersBar: $('peers-bar'), peersSelf: $('peers-self'),
        peersList: $('peers-list'), peersNone: $('peers-none'),
        assignSection: $('assign-section'), assignTarget: $('assign-target'),
        assignTrigger: $('assign-trigger'), assignDrop: $('assign-drop'),
        assignConfirmBtn: $('assign-confirm-btn'),
    };

    // --- Init ---
    async function init() {
        bindEvents();
        await loadAllTasks();
        initSlider();
        await loadPeers();
        setInterval(loadPeers, 5000);
        await loadTasks();
    }

    async function loadAllTasks() {
        try { allTasks = await apiGet('/api/tasks'); }
        catch (e) { allTasks = []; }
    }

    async function loadPeers() {
        try {
            const data = await apiGet('/api/peers');
            peers.self = data.self;
            peers.peers = data.peers;
        } catch (e) { peers.peers = []; }
        renderPeers();
    }

    function renderPeers() {
        if (!peers.peers.length) {
            els.peersNone.style.display = '';
            els.peersList.innerHTML = '';
        } else {
            els.peersNone.style.display = 'none';
            els.peersList.innerHTML = peers.peers.map(p =>
                '<span class="peer-tag' + (selectedPeerId === p.instance_id ? ' selected' : '') + '" data-peer-id="' + p.instance_id + '">' + esc(p.display_name) + '</span>'
            ).join(' | ');
        }

        const myself = peers.self;
        els.peersSelf.innerHTML = '<span class="peer-tag self">' + esc(myself ? myself.display_name : 'You')
            + '<span class="peer-edit" id="peer-name-edit">&#9998;</span></span> ';

        const editBtn = $('peer-name-edit');
        if (editBtn) {
            editBtn.addEventListener('click', e => {
                e.stopPropagation();
                startNameEdit();
            });
        }

        document.querySelectorAll('#peers-list .peer-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const pid = tag.dataset.peerId;
                selectedPeerId = selectedPeerId === pid ? null : pid;
                renderPeers();
            });
        });
    }

    function startNameEdit() {
        const selfTag = els.peersSelf.querySelector('.peer-tag.self');
        const current = peers.self ? peers.self.display_name : 'You';
        selfTag.innerHTML = '<input class="peer-name-input" id="peer-name-input" value="' + esc(current) + '">';
        const input = $('peer-name-input');
        input.focus(); input.select();
        input.addEventListener('blur', () => finishNameEdit(input.value));
        input.addEventListener('keydown', e => { if (e.key === 'Enter') finishNameEdit(input.value); });
    }

    async function finishNameEdit(name) {
        if (!name.trim()) { renderPeers(); return; }
        try {
            await apiPost('/api/identity/name', { name: name.trim() });
            await loadPeers();
        } catch (e) { renderPeers(); }
    }

    function updateAssignUI() {
        if (!selectedTaskId || !peers.peers.length) {
            els.assignSection.classList.add('hidden');
            return;
        }
        const task = tasks.find(t => t.id === selectedTaskId);
        if (!task || task.assigned_to) {
            els.assignSection.classList.add('hidden');
            return;
        }
        els.assignSection.classList.remove('hidden');
        buildMultiSelect(els.assignTrigger, els.assignDrop, peers.peers);
    }

    function buildMultiSelect(trigger, drop, peerList) {
        if (!peerList.length) {
            trigger.textContent = 'No peers online';
            drop.innerHTML = '';
            return;
        }
        trigger.textContent = 'Assign to...';
        drop.innerHTML = peerList.map(p =>
            '<label><input type="checkbox" value="' + p.instance_id + '"> ' + esc(p.display_name) + '</label>'
        ).join('');
    }

    function getCheckedPeers(drop) {
        return Array.from(drop.querySelectorAll('input:checked')).map(cb => cb.value);
    }

    function switchType(type) {
        els.taskType.value = type;
        els.tabNormal.classList.toggle('active', type === 'normal');
        els.tabScript.classList.toggle('active', type === 'script');
        document.querySelectorAll('.normal-only').forEach(el => el.classList.toggle('hidden', type === 'script'));
        document.querySelectorAll('.script-only').forEach(el => el.classList.toggle('hidden', type === 'normal'));
        els.taskName.placeholder = type === 'script' ? 'Label, e.g. deploy staging' : 'Task name';
    }

    function fmtDate(d) { return d.toISOString().split('T')[0]; }
    function fmtDisplay(iso) {
        if (!iso) return '-';
        return new Date(iso).toLocaleString();
    }

    // --- Slider ---
    function initSlider() {
        // Compute date range from all tasks
        let min = null, max = null;
        for (const t of allTasks) {
            const d = new Date(t.created_at);
            if (!min || d < min) min = d;
            if (!max || d > max) max = d;
        }
        const today = new Date();

        // Default filter range
        const pending = allTasks.filter(t => t.status === 'pending' && t.created_at);
        let start = new Date(today); start.setDate(today.getDate() - 3);
        if (pending.length > 0) {
            start = new Date(pending[0].created_at);
            for (const t of pending) { const d = new Date(t.created_at); if (d < start) start = d; }
        }
        start.setHours(0, 0, 0, 0);
        const end = new Date(today); end.setDate(today.getDate() + 3);

        // Ensure min/max encompasses the filter range
        if (!min || start < min) min = new Date(start);
        if (!max || end > max) max = new Date(end);
        min.setDate(min.getDate() - 1);
        max.setDate(max.getDate() + 1);
        min.setHours(0, 0, 0, 0);
        max.setHours(23, 59, 59, 999);
        sliderData.minDate = min;
        sliderData.maxDate = max;

        currentFilter.start = start;
        currentFilter.end = end;
        updateSliderUI();
    }

    function dateToFrac(d) {
        const range = sliderData.maxDate - sliderData.minDate;
        return range > 0 ? (d - sliderData.minDate) / range : 0;
    }
    function fracToDate(f) {
        return new Date(sliderData.minDate.getTime() + f * (sliderData.maxDate - sliderData.minDate));
    }

    function updateSliderUI() {
        const l = dateToFrac(currentFilter.start);
        const r = dateToFrac(currentFilter.end);
        els.handleStart.style.left = (l * 100) + '%';
        els.handleEnd.style.left = (r * 100) + '%';
        els.sliderRange.style.left = (l * 100) + '%';
        els.sliderRange.style.right = ((1 - r) * 100) + '%';
        els.labelStart.textContent = fmtDate(currentFilter.start);
        els.labelEnd.textContent = fmtDate(currentFilter.end);

        // Prevent labels from overflowing screen edges
        if (l < 0.12) {
            els.labelStart.style.left = '0';
            els.labelStart.style.transform = 'translateX(0)';
        } else {
            els.labelStart.style.left = '50%';
            els.labelStart.style.transform = 'translateX(-50%)';
        }
        if (r > 0.88) {
            els.labelEnd.style.left = 'auto';
            els.labelEnd.style.right = '26px';
            els.labelEnd.style.transform = 'translateX(0)';
            els.labelEnd.style.textAlign = 'right';
        } else {
            els.labelEnd.style.left = '50%';
            els.labelEnd.style.right = 'auto';
            els.labelEnd.style.transform = 'translateX(-50%)';
            els.labelEnd.style.textAlign = 'left';
        }
    }

    function sliderFracFromEvent(e) {
        const rect = els.sliderTrack.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    function onSliderStart(e) {
        e.preventDefault();
        const f = sliderFracFromEvent(e);
        const sF = dateToFrac(currentFilter.start);
        const eF = dateToFrac(currentFilter.end);
        // Pick the closer handle
        if (Math.abs(f - sF) <= Math.abs(f - eF)) sliderData.dragging = 'start';
        else sliderData.dragging = 'end';
    }

    function onSliderMove(e) {
        if (!sliderData.dragging) return;
        const f = sliderFracFromEvent(e);
        const d = fracToDate(f);

        // Expand range when handle is at the edge
        if (sliderData.dragging === 'start' && f < 0.03) {
            sliderData.minDate.setDate(sliderData.minDate.getDate() - 7);
            currentFilter.start = sliderData.minDate;
        } else if (sliderData.dragging === 'end' && f > 0.97) {
            sliderData.maxDate.setDate(sliderData.maxDate.getDate() + 7);
            currentFilter.end = sliderData.maxDate;
        } else if (sliderData.dragging === 'start') {
            if (d >= currentFilter.end) return;
            currentFilter.start = d;
        } else {
            if (d <= currentFilter.start) return;
            currentFilter.end = d;
        }
        updateSliderUI();
        debounceLoad();
    }

    function onSliderEnd() {
        if (sliderData.dragging) {
            sliderData.dragging = null;
            loadTasks();
        }
    }

    let debounceTimer;
    function debounceLoad() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(loadTasks, 120);
    }

    // --- Effective date ---
    function effDate(task) {
        if (task.status === 'pending') return task.created_at;
        if (task.status === 'processing') return task.updated_at || task.started_at || task.created_at;
        if (task.status === 'done') return task.completed_at || task.created_at;
        return task.created_at;
    }
    function effDateKey(task) { const d = effDate(task); return d ? d.split('T')[0] : null; }
    function dateFieldForStatus(s) {
        if (s === 'pending') return 'created_at';
        if (s === 'processing') return 'updated_at';
        return 'completed_at';
    }

    // --- Load & Render ---
    async function loadTasks() {
        try {
            tasks = await apiGet('/api/tasks');
        } catch (e) { tasks = []; }
        renderGrid();
    }

    // Filter tasks whose effective date falls within the slider range
    function tasksInRange() {
        if (!currentFilter.start || !currentFilter.end) return tasks;
        const start = currentFilter.start.getTime();
        const end = currentFilter.end.getTime() + 86399999; // end of day
        return tasks.filter(t => {
            const ed = effDate(t);
            if (!ed) return false;
            const ts = new Date(ed).getTime();
            return ts >= start && ts <= end;
        });
    }

    function dateRange() {
        if (!currentFilter.start || !currentFilter.end) return [];
        const dates = [], d = new Date(currentFilter.start);
        d.setHours(0, 0, 0, 0);
        const end = new Date(currentFilter.end); end.setHours(0, 0, 0, 0);
        while (d <= end) { dates.push(new Date(d)); d.setDate(d.getDate() + 1); }
        return dates;
    }

    function renderGrid() {
        const dates = dateRange();
        const todayKey = fmtDate(new Date());
        const visible = tasksInRange();
        const map = {};
        for (const t of visible) {
            const k = effDateKey(t); if (!k) continue;
            const ck = k + '|' + t.status;
            (map[ck] ||= []).push(t);
        }

        let html = '';
        if (!dates.length) {
            html = '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--muted)">Select a date range</td></tr>';
        }
        for (const d of dates) {
            const dk = fmtDate(d);
            html += '<tr' + (dk === todayKey ? ' class="today-row"' : '') + '>';
            html += '<td class="date-cell">' + dk + '</td>';
            for (const st of STATUSES) {
                const cellTasks = map[dk + '|' + st] || [];
                html += '<td class="task-cell" data-date="' + dk + '" data-status="' + st + '">';
                for (const t of cellTasks) html += cardHtml(t);
                html += '</td>';
            }
            html += '</tr>';
        }
        els.gridBody.innerHTML = html;

        document.querySelectorAll('.task-card').forEach(c => {
            c.addEventListener('dragstart', onDragStart);
            c.addEventListener('dragend', onDragEnd);
            c.addEventListener('click', e => {
                if (!dragData || !dragData.dragged) showDetail(c.dataset.taskId);
            });
        });
        document.querySelectorAll('.task-cell').forEach(cell => {
            cell.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
            cell.addEventListener('dragenter', e => { e.preventDefault(); cell.classList.add('drag-over'); });
            cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
            cell.addEventListener('drop', e => { e.preventDefault(); cell.classList.remove('drag-over'); onDrop(cell.dataset.date, cell.dataset.status); });
        });
    }

    function cardHtml(task) {
        if (task.type === 'script') {
            let badge = '';
            let extraClass = '';
            if (task.assigned_by) {
                extraClass = ' assigned-to-me';
                badge = '<span class="assign-badge from">From ' + esc(task.assigned_by.display_name || '?') + '</span>';
            } else if (task.assigned_to) {
                extraClass = ' assigned-out';
                badge = '<span class="assign-badge to">&rarr; ' + esc(task.assigned_to.display_name || '?') + '</span>';
            }
            return '<div class="task-card script-task' + extraClass + '" draggable="true" data-task-id="' + task.id + '">'
                + '<span class="script-icon">&gt;_</span><span class="task-name">' + esc(task.name) + '</span>'
                + badge + '</div>';
        }

        const desc = task.description
            ? '<div class="task-meta">' + esc(task.description.substring(0, 35) + (task.description.length > 35 ? '...' : '')) + '</div>'
            : '';
        const dl = task.deadline ? '<div class="task-meta" style="color:' + (new Date(task.deadline) < Date.now() && task.status !== 'done' ? 'var(--high)' : 'var(--muted)') + '">DL: ' + task.deadline + '</div>' : '';

        let badge = '';
        let extraClass = '';
        if (task.assigned_by) {
            extraClass = ' assigned-to-me';
            badge = '<span class="assign-badge from">From ' + esc(task.assigned_by.display_name || '?') + '</span>';
        } else if (task.assigned_to) {
            extraClass = ' assigned-out';
            badge = '<span class="assign-badge to">&rarr; ' + esc(task.assigned_to.display_name || '?') + '</span>';
        }

        return '<div class="task-card priority-' + task.priority + extraClass + '" draggable="true" data-task-id="' + task.id + '">'
            + '<span class="priority-dot"></span><span class="task-name">' + esc(task.name) + '</span>'
            + badge + desc + dl + '</div>';
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // --- Drag ---
    function onDragStart() { dragData = { taskId: this.dataset.taskId, dragged: false }; this.classList.add('dragging'); }
    function onDragEnd() { this.classList.remove('dragging'); dragData = null; document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over')); }

    async function onDrop(tgtDate, tgtStatus) {
        if (!dragData) return;
        const task = tasks.find(t => t.id === dragData.taskId);
        if (!task) return;
        const srcDate = effDateKey(task), srcStatus = task.status;
        if (srcStatus === tgtStatus && srcDate === tgtDate) return;

        try {
            if (srcStatus !== tgtStatus)
                await apiPatch('/api/tasks/' + task.id + '/move', { status: tgtStatus });
            if (srcDate !== tgtDate) {
                const field = dateFieldForStatus(srcStatus !== tgtStatus ? tgtStatus : srcStatus);
                const cur = tasks.find(t => t.id === dragData.taskId);
                const time = (cur && cur[field]) ? (cur[field].split('T')[1] || '12:00:00') : '12:00:00';
                await apiPut('/api/tasks/' + task.id, { [field]: tgtDate + 'T' + time });
            }
            await loadAllTasks();
            initSlider();
            await loadTasks();
        } catch (e) { await loadTasks(); }
    }

    // --- Detail ---
    function showDetail(taskId) {
        const t = tasks.find(x => x.id === taskId);
        if (!t) return;
        selectedTaskId = t.id;
        els.detailTitle.textContent = t.name;

        const events = [];
        if (t.created_at) events.push({ time: t.created_at, label: 'Created' });
        if (t.started_at) events.push({ time: t.started_at, label: 'Started' });
        if (t.updated_at && t.updated_at !== t.created_at && t.updated_at !== t.started_at && t.updated_at !== t.completed_at)
            events.push({ time: t.updated_at, label: 'Updated' });
        if (t.completed_at) events.push({ time: t.completed_at, label: 'Completed' });
        events.sort((a, b) => a.time.localeCompare(b.time));

        let timelineHtml = '';
        if (t.deadline) {
            const passed = new Date(t.deadline) < Date.now() && t.status !== 'done';
            timelineHtml += '<div class="timeline-item' + (passed ? '' : ' future') + '">'
                + '<div class="tl-label"' + (passed ? ' style="color:var(--high)"' : '') + '>Deadline</div>'
                + '<div class="tl-time"' + (passed ? ' style="color:var(--high)"' : '') + '>' + t.deadline + '</div>'
                + '</div>';
        }
        if (events.length) {
            timelineHtml += events.map((ev, i) => {
                const isLast = i === events.length - 1;
                const currentLabel = { pending: 'Created', processing: 'Updated', done: 'Completed' }[t.status];
                const isCurrent = ev.label === currentLabel || (isLast && !timelineHtml);
                return '<div class="timeline-item' + (isCurrent ? ' current' : '') + '">'
                    + '<div class="tl-label">' + ev.label + '</div>'
                    + '<div class="tl-time">' + fmtDisplay(ev.time) + '</div>'
                    + '</div>';
            }).join('');
        }

        if (t.type === 'script' && t.shell_command) {
            let execHtml = '<p class="label">Command</p><div class="code-block">' + esc(t.shell_command) + '</div>';
            if (t.shell_result) {
                const r = t.shell_result;
                const exitLabel = r.exit_code === 0 ? 'Exit 0' : 'Exit ' + r.exit_code;
                execHtml += '<p class="label" style="margin-top:8px;">Result</p>';
                execHtml += '<div class="exec-result ' + (r.exit_code === 0 ? 'stdout' : 'stderr') + '">';
                execHtml += '<div class="result-label">' + exitLabel + ' - ' + (r.executed_at || '') + '</div>';
                if (r.stdout) execHtml += '<pre>' + esc(r.stdout) + '</pre>';
                if (r.stderr) execHtml += '<pre style="color:var(--high)">' + esc(r.stderr) + '</pre>';
                execHtml += '</div>';
            } else if (t.assigned_to && peers.self && t.assigned_to.instance_id === peers.self.instance_id && t.status !== 'done') {
                execHtml += '<button class="btn-execute" id="execute-btn" style="margin-top:8px;">Execute</button>';
            }
            els.detailContent.innerHTML = '<p class="label">Type</p><p>Script</p>'
                + '<p class="label">Status</p><p>' + t.status.charAt(0).toUpperCase() + t.status.slice(1) + '</p>'
                + execHtml
                + '<p class="label" style="margin-top:8px;">Timeline</p>'
                + '<div class="timeline">' + timelineHtml + '</div>';

            const execBtn = $('execute-btn');
            if (execBtn) {
                execBtn.addEventListener('click', async () => {
                    if (!confirm('Run: ' + t.shell_command + '?')) return;
                    try {
                        await apiPost('/api/tasks/' + t.id + '/execute');
                        await loadAllTasks(); await loadTasks();
                        const updated = tasks.find(x => x.id === t.id);
                        if (updated) showDetail(updated.id);
                    } catch (err) { alert('Execute failed: ' + err.message); }
                });
            }
        } else {
            els.detailContent.innerHTML =
                '<p class="label">Status</p><p>' + t.status.charAt(0).toUpperCase() + t.status.slice(1) + '</p>'
                + '<p class="label">Priority</p><p>' + t.priority.charAt(0).toUpperCase() + t.priority.slice(1) + '</p>'
                + (t.description ? '<p class="label">Description</p><div class="desc-block" id="desc-block">' + esc(t.description) + '</div>' : '')
                + (t.deadline ? '<p class="label">Deadline</p><p>' + t.deadline + '</p>' : '')
                + '<p class="label" style="margin-top:8px;">Timeline</p>'
                + '<div class="timeline">' + timelineHtml + '</div>';

            const descBlock = $('desc-block');
            if (descBlock) {
                descBlock.addEventListener('click', () => showDescFullscreen(t));
            }
        }

        els.detailModal.classList.remove('hidden');
        updateAssignUI();
    }

    // --- Description fullscreen ---
    function showDescFullscreen(t) {
        els.fullscreenContent.innerHTML =
            '<div class="description-entry">'
            + '<div class="entry-header"><span class="priority-dot ' + t.priority + '" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--' + t.priority + ')"></span>' + esc(t.name) + '</div>'
            + '<div class="entry-status">' + t.status + '</div>'
            + '<div class="entry-body">' + esc(t.description || '') + '</div>'
            + '</div>';
        els.fullscreen.classList.remove('hidden');
    }

    // --- All descriptions fullscreen ---
    function showAllFullscreen() {
        const withDesc = tasks.filter(t => t.description);
        if (!withDesc.length) {
            els.fullscreenContent.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px;">No descriptions yet</p>';
        } else {
            els.fullscreenContent.innerHTML = withDesc.map(t =>
                '<div class="description-entry">'
                + '<div class="entry-header"><span class="priority-dot ' + t.priority + '" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--' + t.priority + ')"></span>' + esc(t.name) + '</div>'
                + '<div class="entry-status">' + t.status + '</div>'
                + '<div class="entry-date">' + fmtDisplay(t.created_at) + '</div>'
                + '<div class="entry-body">' + esc(t.description) + '</div>'
                + '</div>'
            ).join('');
        }
        els.fullscreen.classList.remove('hidden');
    }

    // --- Add / Edit modals ---
    function showAdd() {
        els.taskName.value = ''; els.taskDesc.value = '';
        els.taskDeadline.value = ''; els.taskPriority.value = 'medium';
        els.taskCommand.value = '';
        switchType('normal');
        buildMultiSelect(els.taskAssignTrigger, els.taskAssignDrop, peers.peers);
        els.addTaskModal.classList.remove('hidden'); els.taskName.focus();
    }
    function hideAdd() { els.addTaskModal.classList.add('hidden'); }
    function showEdit() {
        const t = tasks.find(x => x.id === selectedTaskId);
        if (!t) return;
        els.editName.value = t.name; els.editDesc.value = t.description || '';
        els.editDeadline.value = t.deadline || ''; els.editPriority.value = t.priority;
        els.detailModal.classList.add('hidden');
        els.editModal.classList.remove('hidden'); els.editName.focus();
    }
    function hideEdit() { els.editModal.classList.add('hidden'); }

    // --- Events ---
    function bindEvents() {
        // Slider
        els.sliderTrack.addEventListener('mousedown', onSliderStart);
        document.addEventListener('mousemove', onSliderMove);
        document.addEventListener('mouseup', onSliderEnd);

        els.addTaskBtn.addEventListener('click', showAdd);
        els.addTaskForm.addEventListener('submit', async e => {
            e.preventDefault();
            const name = els.taskName.value.trim();
            if (!name) return;
            const taskType = els.taskType.value;
            const payload = { name, type: taskType };
            if (taskType === 'script') {
                payload.shell_command = els.taskCommand.value.trim();
            } else {
                payload.description = els.taskDesc.value.trim();
                payload.deadline = els.taskDeadline.value || null;
                payload.priority = els.taskPriority.value;
            }
            const task = await apiPost('/api/tasks', payload);
            const targets = getCheckedPeers(els.taskAssignDrop);
            for (const toInstance of targets) {
                try { await apiPost('/api/tasks/' + task.id + '/assign', { to_instance: toInstance }); }
                catch (err) { /* assign failed for one peer, continue */ }
            }
            hideAdd();
            await loadAllTasks(); initSlider(); await loadTasks();
        });
        els.cancelAdd.addEventListener('click', hideAdd);

        els.closeDetail.addEventListener('click', () => els.detailModal.classList.add('hidden'));
        els.editTaskBtn.addEventListener('click', showEdit);

        els.editForm.addEventListener('submit', async e => {
            e.preventDefault();
            const name = els.editName.value.trim();
            if (!name || !selectedTaskId) return;
            await apiPut('/api/tasks/' + selectedTaskId, {
                name, description: els.editDesc.value.trim(),
                deadline: els.editDeadline.value || null,
                priority: els.editPriority.value
            });
            hideEdit();
            await loadAllTasks(); await loadTasks();
            const t = tasks.find(x => x.id === selectedTaskId);
            if (t) showDetail(selectedTaskId);
        });
        els.cancelEdit.addEventListener('click', hideEdit);

        els.deleteTaskBtn.addEventListener('click', async () => {
            if (!confirm('Delete this task?')) return;
            await fetch('/api/tasks/' + selectedTaskId, { method: 'DELETE' });
            els.detailModal.classList.add('hidden');
            await loadAllTasks(); initSlider(); await loadTasks();
        });

        els.assignConfirmBtn.addEventListener('click', async () => {
            const targets = getCheckedPeers(els.assignDrop);
            if (!targets.length || !selectedTaskId) return;
            try {
                for (const toInstance of targets) {
                    await apiPost('/api/tasks/' + selectedTaskId + '/assign', { to_instance: toInstance });
                }
                els.detailModal.classList.add('hidden');
                selectedPeerId = null;
                await loadAllTasks(); initSlider(); await loadTasks();
                renderPeers();
            } catch (e) { alert('Failed to assign: ' + e.message); }
        });

        els.fullscreenBtn.addEventListener('click', showAllFullscreen);
        els.closeFullscreen.addEventListener('click', () => els.fullscreen.classList.add('hidden'));

        // Type switcher tabs
        els.tabNormal.addEventListener('click', () => switchType('normal'));
        els.tabScript.addEventListener('click', () => switchType('script'));

        // Multi-select dropdown toggles
        function toggleDrop(trigger, drop) {
            const open = drop.classList.contains('open');
            document.querySelectorAll('.multi-select-drop.open').forEach(d => d.classList.remove('open'));
            document.querySelectorAll('.multi-select-trigger.open').forEach(t => t.classList.remove('open'));
            if (!open) { drop.classList.add('open'); trigger.classList.add('open'); }
        }
        els.taskAssignTrigger.addEventListener('click', () => toggleDrop(els.taskAssignTrigger, els.taskAssignDrop));
        els.assignTrigger.addEventListener('click', () => toggleDrop(els.assignTrigger, els.assignDrop));
        document.addEventListener('click', e => {
            if (!e.target.closest('.multi-select')) {
                document.querySelectorAll('.multi-select-drop.open').forEach(d => d.classList.remove('open'));
                document.querySelectorAll('.multi-select-trigger.open').forEach(t => t.classList.remove('open'));
            }
        });

        [els.addTaskModal, els.detailModal, els.editModal].forEach(m => {
            m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                els.addTaskModal.classList.add('hidden');
                els.detailModal.classList.add('hidden');
                els.editModal.classList.add('hidden');
                els.fullscreen.classList.add('hidden');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();