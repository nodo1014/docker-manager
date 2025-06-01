const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const winston = require('winston');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const YAML = require('yaml');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3002;

// 로깅 설정
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// 기본 사용자 설정 (실제 환경에서는 환경 변수나 설정 파일에서 로드)
const DEFAULT_USER = {
  username: 'admin',
  // 기본 비밀번호: 'admin123'
  // 평문 비밀번호 사용 (개발용, 실제 환경에서는 해시 사용)
  password: 'admin123'
};

app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'kdocker-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 3600000 } // 1시간
}));
app.use(express.static('public'));

// 명령어 실행 헬퍼 함수
const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

// 현재 사용중인 포트 조회
app.get('/api/ports', async (req, res) => {
  try {
    const result = await executeCommand('netstat -tulpn | grep LISTEN');
    const ports = result.stdout.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        const address = parts[3];
        const pid = parts[6];
        const port = address.split(':').pop();
        return {
          port,
          address,
          pid: pid ? pid.split('/')[0] : 'N/A',
          process: pid ? pid.split('/')[1] : 'N/A'
        };
      });
    res.json(ports);
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 특정 포트 프로세스 종료
app.post('/api/ports/:port/kill', async (req, res) => {
  const { port } = req.params;
  try {
    // 포트를 사용하는 프로세스 찾기
    const findResult = await executeCommand(`lsof -ti:${port}`);
    if (findResult.stdout.trim()) {
      const pid = findResult.stdout.trim();
      await executeCommand(`kill -9 ${pid}`);
      res.json({ message: `포트 ${port}의 프로세스(PID: ${pid})를 종료했습니다.` });
    } else {
      res.json({ message: `포트 ${port}를 사용하는 프로세스가 없습니다.` });
    }
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컨테이너 목록
app.get('/api/docker/containers', async (req, res) => {
  try {
    const result = await executeCommand('docker ps -a --format "{{.ID}}\t{{.Image}}\t{{.Command}}\t{{.CreatedAt}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}"');
    const lines = result.stdout.split('\n').filter(line => line.trim());
    const containers = lines.map(line => {
      const parts = line.split('\t');
      return {
        id: parts[0] || '',
        image: parts[1] || '',
        command: parts[2] || '',
        created: parts[3] || '',
        status: parts[4] || '',
        ports: parts[5] || '',
        names: parts[6] || ''
      };
    });
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컨테이너 시작
app.post('/api/docker/containers/:id/start', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeCommand(`docker start ${id}`);
    res.json({ message: `컨테이너 ${id}를 시작했습니다.`, output: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컨테이너 정지
app.post('/api/docker/containers/:id/stop', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeCommand(`docker stop ${id}`);
    res.json({ message: `컨테이너 ${id}를 정지했습니다.`, output: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컨테이너 삭제
app.post('/api/docker/containers/:id/remove', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeCommand(`docker rm ${id}`);
    res.json({ message: `컨테이너 ${id}를 삭제했습니다.`, output: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컴포즈 down
app.post('/api/docker/compose/down', async (req, res) => {
  try {
    const result = await executeCommand('docker-compose down');
    res.json({ message: '도커 컴포즈를 내렸습니다.', output: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 시스템 prune
app.post('/api/docker/prune', async (req, res) => {
  try {
    const result = await executeCommand('docker system prune -f');
    res.json({ message: '도커 시스템 정리를 완료했습니다.', output: result.stdout });
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 이미지 목록
app.get('/api/docker/images', async (req, res) => {
  try {
    const result = await executeCommand('docker images --format "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}"');
    const lines = result.stdout.split('\n').filter(line => line.trim());
    const images = lines.map(line => {
      const parts = line.split('\t');
      return {
        repository: parts[0] || '',
        tag: parts[1] || '',
        id: parts[2] || '',
        created: parts[3] || '',
        size: parts[4] || ''
      };
    });
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: error.error || error.message });
  }
});

// 인증 미들웨어
const authMiddleware = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.status(401).json({ error: '인증이 필요합니다.' });
  }
};

// 로그인 API
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    // 평문 비밀번호 비교로 변경
    if (username === DEFAULT_USER.username && password === DEFAULT_USER.password) {
      req.session.isAuthenticated = true;
      req.session.username = username;
      res.json({ success: true, username });
    } else {
      res.status(401).json({ error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }
  } catch (error) {
    logger.error('로그인 오류:', error);
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// 로그아웃 API
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 인증 상태 확인 API
app.get('/api/auth/status', (req, res) => {
  res.json({ 
    isAuthenticated: !!req.session.isAuthenticated,
    username: req.session.username || null
  });
});

// 기존 API에 인증 미들웨어 적용
app.get('/api/ports', authMiddleware, async (req, res) => {
  try {
    const result = await executeCommand('netstat -tulpn | grep LISTEN');
    const ports = result.stdout.split('\\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split(/\\s+/);
        const address = parts[3];
        const pid = parts[6];
        const port = address.split(':').pop();
        return {
          port,
          address,
          pid: pid ? pid.split('/')[0] : 'N/A',
          process: pid ? pid.split('/')[1] : 'N/A'
        };
      });
    res.json(ports);
  } catch (error) {
    logger.error('포트 조회 오류:', error);
    res.status(500).json({ error: error.error || error.message });
  }
});

// 컨테이너 로그 조회 API
app.get('/api/docker/containers/:id/logs', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { lines = 100 } = req.query;
  
  try {
    const result = await executeCommand(`docker logs --tail ${lines} ${id}`);
    res.json({ logs: result.stdout });
  } catch (error) {
    logger.error(`컨테이너 로그 조회 오류 (ID: ${id}):`, error);
    res.status(500).json({ error: error.error || error.message });
  }
});

// 도커 컴포즈 파일 목록 조회
app.get('/api/docker/compose/files', authMiddleware, (req, res) => {
  const composeDir = path.join(__dirname, 'compose-files');
  
  // 디렉토리가 없으면 생성
  if (!fs.existsSync(composeDir)) {
    fs.mkdirSync(composeDir, { recursive: true });
  }
  
  try {
    const files = fs.readdirSync(composeDir)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
      .map(file => ({
        name: file,
        path: path.join(composeDir, file)
      }));
    
    res.json(files);
  } catch (error) {
    logger.error('컴포즈 파일 목록 조회 오류:', error);
    res.status(500).json({ error: '컴포즈 파일 목록을 조회할 수 없습니다.' });
  }
});

// 도커 컴포즈 파일 내용 조회
app.get('/api/docker/compose/files/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'compose-files', filename);
  
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    logger.error(`컴포즈 파일 조회 오류 (${filename}):`, error);
    res.status(500).json({ error: '파일을 읽을 수 없습니다.' });
  }
});

// 도커 컴포즈 파일 저장
app.post('/api/docker/compose/files/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  const { content } = req.body;
  const filePath = path.join(__dirname, 'compose-files', filename);
  
  try {
    // YAML 유효성 검사
    YAML.parse(content);
    
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, message: '파일이 저장되었습니다.' });
  } catch (error) {
    logger.error(`컴포즈 파일 저장 오류 (${filename}):`, error);
    res.status(500).json({ error: '파일을 저장할 수 없습니다. YAML 형식이 올바른지 확인하세요.' });
  }
});

// 도커 컴포즈 실행
app.post('/api/docker/compose/up/:filename', authMiddleware, async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'compose-files', filename);
  
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    const result = await executeCommand(`docker-compose -f ${filePath} up -d`);
    res.json({ success: true, message: '도커 컴포즈가 실행되었습니다.', output: result.stdout });
  } catch (error) {
    logger.error(`도커 컴포즈 실행 오류 (${filename}):`, error);
    res.status(500).json({ error: error.error || error.message });
  }
});

// 웹소켓 연결 처리
io.on('connection', (socket) => {
  logger.info('클라이언트가 웹소켓에 연결됨');
  
  // 인증 확인
  socket.on('authenticate', (sessionId) => {
    // 실제 구현에서는 세션 저장소에서 세션 ID 확인 필요
    socket.isAuthenticated = true;
    socket.join('authenticated');
    socket.emit('authenticated', true);
  });
  
  socket.on('disconnect', () => {
    logger.info('클라이언트 연결 종료');
  });
});

// 실시간 업데이트를 위한 함수
const broadcastContainers = async () => {
  try {
    const result = await executeCommand('docker ps -a --format "{{.ID}}\\t{{.Image}}\\t{{.Command}}\\t{{.CreatedAt}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Names}}"');
    const lines = result.stdout.split('\\n').filter(line => line.trim());
    const containers = lines.map(line => {
      const parts = line.split('\\t');
      return {
        id: parts[0] || '',
        image: parts[1] || '',
        command: parts[2] || '',
        created: parts[3] || '',
        status: parts[4] || '',
        ports: parts[5] || '',
        names: parts[6] || ''
      };
    });
    
    io.to('authenticated').emit('containers-update', containers);
  } catch (error) {
    logger.error('컨테이너 브로드캐스트 오류:', error);
  }
};

// 주기적으로 컨테이너 상태 업데이트
setInterval(broadcastContainers, 5000);

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  logger.error('서버 오류:', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

server.listen(PORT, () => {
  logger.info(`서버가 포트 ${PORT}에서 실행중입니다.`);
  logger.info(`http://localhost:${PORT} 에서 웹 인터페이스에 접근할 수 있습니다.`);
});
