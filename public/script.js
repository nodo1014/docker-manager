const API_BASE = '';
let socket;

// 인증 확인
async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/status`);
        const data = await response.json();
        
        if (!data.isAuthenticated) {
            window.location.href = '/login.html';
            return false;
        }
        
        // 로그인 상태 표시
        const usernameElement = document.getElementById('username-display');
        if (usernameElement) {
            usernameElement.textContent = data.username;
        }
        
        // 웹소켓 연결
        connectWebSocket();
        
        return true;
    } catch (error) {
        console.error('인증 확인 오류:', error);
        return false;
    }
}

// 로그아웃
async function logout() {
    try {
        await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        showNotification('로그아웃 중 오류가 발생했습니다.', 'error');
    }
}

// 웹소켓 연결
function connectWebSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('웹소켓 연결됨');
        socket.emit('authenticate', document.cookie); // 세션 ID 전송
    });
    
    socket.on('authenticated', (status) => {
        console.log('인증 상태:', status);
    });
    
    socket.on('containers-update', (containers) => {
        updateContainersTable(containers);
    });
    
    socket.on('disconnect', () => {
        console.log('웹소켓 연결 끊김');
    });
}

// 컨테이너 테이블 업데이트 (웹소켓)
function updateContainersTable(containers) {
    const table = document.getElementById('containers-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // 현재 체크된 컨테이너 ID 저장
    const checkedIds = Array.from(document.querySelectorAll('.container-checkbox:checked'))
        .map(checkbox => checkbox.value);
    
    tbody.innerHTML = '';
    
    if (containers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">도커 컨테이너가 없습니다.</td></tr>';
        return;
    }
    
    containers.forEach(container => {
        const statusClass = container.status.includes('Up') ? 'status-running' : 
                           container.status.includes('Exited') ? 'status-exited' : 'status-created';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox" class="container-checkbox" value="${container.id}" onchange="updateSelectionCount()" ${checkedIds.includes(container.id) ? 'checked' : ''}></td>
            <td>${container.id.substring(0, 12)}</td>
            <td>${container.image}</td>
            <td class="${statusClass}">${container.status}</td>
            <td>${container.ports || '-'}</td>
            <td>${container.names}</td>
            <td>
                ${container.status.includes('Up') ? 
                    `<button class="btn btn-danger" onclick="stopContainer('${container.id}')">정지</button>` :
                    `<button class="btn btn-success" onclick="startContainer('${container.id}')">시작</button>`
                }
                <button class="btn btn-info" onclick="viewContainerLogs('${container.id}')">로그</button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    updateSelectionCount();
}

// 컨테이너 로그 보기
async function viewContainerLogs(id) {
    try {
        const result = await apiCall(`/docker/containers/${id}/logs`);
        
        // 모달 생성
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>컨테이너 로그 (${id.substring(0, 12)})</h3>
                    <span class="close-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <pre class="container-logs">${result.logs}</pre>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 모달 닫기 이벤트
        modal.querySelector('.close-modal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // 모달 외부 클릭 시 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 도커 컴포즈 파일 관리
async function loadComposeFiles() {
    const container = document.getElementById('compose-files-container');
    container.innerHTML = '<p>로딩중...</p>';
    
    try {
        const files = await apiCall('/docker/compose/files');
        
        if (files.length === 0) {
            container.innerHTML = '<p>도커 컴포즈 파일이 없습니다.</p>';
            return;
        }
        
        const fileList = document.createElement('div');
        fileList.className = 'compose-file-list';
        
        files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'compose-file-item';
            fileItem.innerHTML = `
                <span>${file.name}</span>
                <div>
                    <button class="btn btn-primary btn-sm" onclick="editComposeFile('${file.name}')">편집</button>
                    <button class="btn btn-success btn-sm" onclick="runComposeFile('${file.name}')">실행</button>
                </div>
            `;
            fileList.appendChild(fileItem);
        });
        
        container.innerHTML = '';
        container.appendChild(fileList);
        
        // 새 파일 생성 버튼
        const newFileBtn = document.createElement('button');
        newFileBtn.className = 'btn btn-primary';
        newFileBtn.textContent = '새 컴포즈 파일';
        newFileBtn.onclick = createNewComposeFile;
        container.appendChild(newFileBtn);
    } catch (error) {
        container.innerHTML = '<p>컴포즈 파일을 불러올 수 없습니다.</p>';
    }
}

// 컴포즈 파일 편집
async function editComposeFile(filename) {
    try {
        const result = await apiCall(`/docker/compose/files/${filename}`);
        
        // 모달 생성
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h3>컴포즈 파일 편집: ${filename}</h3>
                    <span class="close-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <textarea id="compose-editor" class="code-editor">${result.content}</textarea>
                    <div class="modal-footer">
                        <button class="btn btn-primary" onclick="saveComposeFile('${filename}')">저장</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 모달 닫기 이벤트
        modal.querySelector('.close-modal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // 모달 외부 클릭 시 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 컴포즈 파일 저장
async function saveComposeFile(filename) {
    const content = document.getElementById('compose-editor').value;
    
    try {
        await apiCall(`/docker/compose/files/${filename}`, 'POST', { content });
        showNotification('파일이 저장되었습니다.', 'success');
        
        // 모달 닫기
        const modal = document.querySelector('.modal');
        if (modal) {
            document.body.removeChild(modal);
        }
        
        // 파일 목록 새로고침
        loadComposeFiles();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 새 컴포즈 파일 생성
function createNewComposeFile() {
    // 모달 생성
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>새 컴포즈 파일 생성</h3>
                <span class="close-modal">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="new-filename">파일명</label>
                    <input type="text" id="new-filename" placeholder="docker-compose.yml">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="createComposeFile()">생성</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 모달 닫기 이벤트
    modal.querySelector('.close-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 컴포즈 파일 생성
async function createComposeFile() {
    const filename = document.getElementById('new-filename').value;
    
    if (!filename) {
        showNotification('파일명을 입력하세요.', 'error');
        return;
    }
    
    if (!filename.endsWith('.yml') && !filename.endsWith('.yaml')) {
        showNotification('파일명은 .yml 또는 .yaml로 끝나야 합니다.', 'error');
        return;
    }
    
    const defaultContent = `version: '3'
services:
  # 서비스 정의
  # example:
  #   image: nginx
  #   ports:
  #     - "8080:80"
`;
    
    try {
        await apiCall(`/docker/compose/files/${filename}`, 'POST', { content: defaultContent });
        showNotification('파일이 생성되었습니다.', 'success');
        
        // 모달 닫기
        const modal = document.querySelector('.modal');
        if (modal) {
            document.body.removeChild(modal);
        }
        
        // 파일 목록 새로고침
        loadComposeFiles();
        
        // 생성된 파일 편집
        setTimeout(() => {
            editComposeFile(filename);
        }, 500);
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 컴포즈 파일 실행
async function runComposeFile(filename) {
    if (!confirm(`${filename} 파일을 사용하여 도커 컴포즈를 실행하시겠습니까?`)) {
        return;
    }
    
    try {
        const result = await apiCall(`/docker/compose/up/${filename}`, 'POST');
        showNotification(result.message, 'success');
        loadContainers();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 탭 관리
function openTab(evt, tabName) {
    const tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].classList.remove("active");
    }
    
    const tabButtons = document.getElementsByClassName("tab-button");
    for (let i = 0; i < tabButtons.length; i++) {
        tabButtons[i].classList.remove("active");
    }
    
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");
}

// 알림 표시
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// API 호출 헬퍼
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(`${API_BASE}/api${endpoint}`, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'API 호출 실패');
        }
        
        return data;
    } catch (error) {
        showNotification(error.message, 'error');
        throw error;
    }
}

// 포트 관리
async function loadPorts() {
    const table = document.getElementById('ports-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '<tr><td colspan="5">로딩중...</td></tr>';
    
    try {
        const ports = await apiCall('/ports');
        tbody.innerHTML = '';
        
        if (ports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">사용중인 포트가 없습니다.</td></tr>';
            return;
        }
        
        ports.forEach(port => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${port.port}</td>
                <td>${port.address}</td>
                <td>${port.pid}</td>
                <td>${port.process}</td>
                <td>
                    <button class="btn btn-danger" onclick="killPort('${port.port}')">
                        종료
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5">포트 정보를 불러올 수 없습니다.</td></tr>';
    }
}

async function killPort(port) {
    if (!confirm(`포트 ${port}를 사용하는 프로세스를 종료하시겠습니까?`)) {
        return;
    }
    
    try {
        const result = await apiCall(`/ports/${port}/kill`, 'POST');
        showNotification(result.message, 'success');
        loadPorts();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 도커 컨테이너 관리
async function loadContainers() {
    const table = document.getElementById('containers-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '<tr><td colspan="6">로딩중...</td></tr>';
    
    try {
        const containers = await apiCall('/docker/containers');
        tbody.innerHTML = '';
        
        if (containers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">도커 컨테이너가 없습니다.</td></tr>';
            return;
        }
        
        containers.forEach(container => {
            const statusClass = container.status.includes('Up') ? 'status-running' : 
                               container.status.includes('Exited') ? 'status-exited' : 'status-created';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="checkbox" class="container-checkbox" value="${container.id}" onchange="updateSelectionCount()"></td>
                <td>${container.id.substring(0, 12)}</td>
                <td>${container.image}</td>
                <td class="${statusClass}">${container.status}</td>
                <td>${container.ports || '-'}</td>
                <td>${container.names}</td>
                <td>
                    ${container.status.includes('Up') ? 
                        `<button class="btn btn-danger" onclick="stopContainer('${container.id}')">정지</button>` :
                        `<button class="btn btn-success" onclick="startContainer('${container.id}')">시작</button>`
                    }
                </td>
            `;
            tbody.appendChild(row);
        });
        
        updateSelectionCount();
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7">컨테이너 정보를 불러올 수 없습니다.</td></tr>';
    }
}

async function startContainer(id) {
    try {
        const result = await apiCall(`/docker/containers/${id}/start`, 'POST');
        showNotification(result.message, 'success');
        loadContainers();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

async function stopContainer(id) {
    if (!confirm('컨테이너를 정지하시겠습니까?')) {
        return;
    }
    
    try {
        const result = await apiCall(`/docker/containers/${id}/stop`, 'POST');
        showNotification(result.message, 'success');
        loadContainers();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

async function dockerComposeDown() {
    if (!confirm('도커 컴포즈를 내리시겠습니까?')) {
        return;
    }
    
    try {
        const result = await apiCall('/docker/compose/down', 'POST');
        showNotification(result.message, 'success');
        loadContainers();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

async function dockerPrune() {
    if (!confirm('도커 시스템을 정리하시겠습니까? (사용하지 않는 이미지, 컨테이너, 네트워크가 삭제됩니다)')) {
        return;
    }
    
    try {
        const result = await apiCall('/docker/prune', 'POST');
        showNotification(result.message, 'success');
        loadContainers();
        loadImages();
    } catch (error) {
        // 이미 showNotification이 apiCall에서 호출됨
    }
}

// 도커 이미지 관리
async function loadImages() {
    const table = document.getElementById('images-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '<tr><td colspan="5">로딩중...</td></tr>';
    
    try {
        const images = await apiCall('/docker/images');
        tbody.innerHTML = '';
        
        if (images.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">도커 이미지가 없습니다.</td></tr>';
            return;
        }
        
        images.forEach(image => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${image.repository}</td>
                <td>${image.tag}</td>
                <td>${image.id.substring(0, 12)}</td>
                <td>${image.created}</td>
                <td>${image.size}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5">이미지 정보를 불러올 수 없습니다.</td></tr>';
    }
}

// 체크박스 관련 함수들
function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAll');
    const containerCheckboxes = document.querySelectorAll('.container-checkbox');
    
    containerCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
    
    updateSelectionCount();
}

function updateSelectionCount() {
    const containerCheckboxes = document.querySelectorAll('.container-checkbox');
    const checkedBoxes = document.querySelectorAll('.container-checkbox:checked');
    const selectedCount = checkedBoxes.length;
    const totalCount = containerCheckboxes.length;
    
    document.getElementById('selectedCount').textContent = `선택된 항목: ${selectedCount}개`;
    
    // 전체 선택 체크박스 상태 업데이트
    const selectAllCheckbox = document.getElementById('selectAll');
    if (selectedCount === 0) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = false;
    } else if (selectedCount === totalCount) {
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.checked = true;
    } else {
        selectAllCheckbox.indeterminate = true;
    }
    
    // 일괄 작업 버튼 활성화/비활성화
    const bulkButtons = ['bulkStartBtn', 'bulkStopBtn', 'bulkRemoveBtn'];
    bulkButtons.forEach(btnId => {
        document.getElementById(btnId).disabled = selectedCount === 0;
    });
}

function getSelectedContainerIds() {
    const checkedBoxes = document.querySelectorAll('.container-checkbox:checked');
    return Array.from(checkedBoxes).map(checkbox => checkbox.value);
}

// 일괄 작업 함수들
async function bulkStartContainers() {
    const selectedIds = getSelectedContainerIds();
    if (selectedIds.length === 0) {
        showNotification('선택된 컨테이너가 없습니다.', 'warning');
        return;
    }
    
    if (!confirm(`선택된 ${selectedIds.length}개의 컨테이너를 시작하시겠습니까?`)) {
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const id of selectedIds) {
        try {
            await apiCall(`/docker/containers/${id}/start`, 'POST');
            successCount++;
        } catch (error) {
            errorCount++;
        }
    }
    
    showNotification(`${successCount}개 시작 완료, ${errorCount}개 실패`, 
                    errorCount === 0 ? 'success' : 'warning');
    loadContainers();
}

async function bulkStopContainers() {
    const selectedIds = getSelectedContainerIds();
    if (selectedIds.length === 0) {
        showNotification('선택된 컨테이너가 없습니다.', 'warning');
        return;
    }
    
    if (!confirm(`선택된 ${selectedIds.length}개의 컨테이너를 정지하시겠습니까?`)) {
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const id of selectedIds) {
        try {
            await apiCall(`/docker/containers/${id}/stop`, 'POST');
            successCount++;
        } catch (error) {
            errorCount++;
        }
    }
    
    showNotification(`${successCount}개 정지 완료, ${errorCount}개 실패`, 
                    errorCount === 0 ? 'success' : 'warning');
    loadContainers();
}

async function bulkRemoveContainers() {
    const selectedIds = getSelectedContainerIds();
    if (selectedIds.length === 0) {
        showNotification('선택된 컨테이너가 없습니다.', 'warning');
        return;
    }
    
    if (!confirm(`선택된 ${selectedIds.length}개의 컨테이너를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const id of selectedIds) {
        try {
            await apiCall(`/docker/containers/${id}/remove`, 'POST');
            successCount++;
        } catch (error) {
            errorCount++;
        }
    }
    
    showNotification(`${successCount}개 삭제 완료, ${errorCount}개 실패`, 
                    errorCount === 0 ? 'success' : 'warning');
    loadContainers();
}

// 초기화
document.addEventListener('DOMContentLoaded', async function() {
    // 인증 확인
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;
    
    loadPorts();
    loadContainers();
    loadImages();
    
    // 도커 컴포즈 탭이 있으면 로드
    if (document.getElementById('compose')) {
        loadComposeFiles();
    }
    
    // 웹소켓이 없을 경우에만 폴링 사용
    if (!socket || !socket.connected) {
        // 30초마다 자동 새로고침
        setInterval(() => {
            if (document.getElementById('ports').classList.contains('active')) {
                loadPorts();
            } else if (document.getElementById('docker').classList.contains('active')) {
                loadContainers();
            }
        }, 30000);
    }
});
