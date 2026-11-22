require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { types } = require('pg');

// CockroachDB returns BIGINT values as strings by default. Portal IDs are
// sequential and remain within JavaScript's safe integer range.
types.setTypeParser(20, value => Number(value));
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DOMAIN = '@students.sau.ac.in';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random string of at least 32 characters in .env');

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.DB_HOST,
  port: process.env.DATABASE_URL ? undefined : Number(process.env.DB_PORT || 26257),
  user: process.env.DATABASE_URL ? undefined : process.env.DB_USER,
  password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME || 'defaultdb'),
  ssl: process.env.DB_SSL === 'false' ? false : {
    rejectUnauthorized: true,
    ...(process.env.DB_SSL_CA_PATH ? { ca: fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8') } : {})
  },
  max: 10,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000
});

// Keep the existing route code's [rows] / insertId / affectedRows pattern,
// while translating MySQL-style ? parameters to PostgreSQL $1, $2, ... .
function toPostgresSql(sql) {
  let index = 0;
  return sql
    .replace(/DATE_ADD\(NOW\(\),\s*INTERVAL\s+30\s+MINUTE\)/gi, "(NOW() + INTERVAL '30 minutes')")
    .replace(/\?/g, () => `$${++index}`);
}
async function runQuery(sql, params = []) {
  const result = await pgPool.query({ text: toPostgresSql(sql), values: params });
  const command = (sql.trim().match(/^[a-z]+/i) || [''])[0].toUpperCase();
  if (['INSERT', 'UPDATE', 'DELETE'].includes(command)) {
    return [{ insertId: result.rows[0]?.id ?? null, affectedRows: result.rowCount }];
  }
  return [result.rows];
}
const pool = { query: runQuery, execute: runQuery };
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const publicDir = path.join(__dirname,'public');
const uploadDir = path.join(__dirname,'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV === 'production' ? [] : null}}}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false}));
app.use(cookieParser());
app.use('/uploads',express.static(uploadDir,{maxAge:'7d'}));
app.use(express.static(publicDir));
app.use('/api/',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
const authLimiter = rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:true,legacyHeaders:false,message:{error:'Too many authentication attempts. Try again later.'}});

const signToken = user => jwt.sign({id:user.id,role:user.role},JWT_SECRET,{expiresIn:'8h'});
const cookieOptions = {httpOnly:true,secure:process.env.COOKIE_SECURE === 'true',sameSite:'lax',maxAge:8*60*60*1000,path:'/'};
function issueSession(res,user){res.cookie('sau_session',signToken(user),cookieOptions);}
function clearSession(res){res.clearCookie('sau_session',{httpOnly:true,secure:cookieOptions.secure,sameSite:'lax',path:'/'});}
const requireAuth = asyncRoute(async(req,res,next)=>{
  const token=req.cookies.sau_session;
  if(!token) return res.status(401).json({error:'Please sign in to continue.'});
  try {
    const decoded=jwt.verify(token,JWT_SECRET);
    const [rows]=await pool.execute('SELECT id,name,email,role,is_active,email_verified_at FROM users WHERE id=? LIMIT 1',[decoded.id]);
    if(!rows.length || !rows[0].is_active) {clearSession(res);return res.status(401).json({error:'Account is unavailable.'});}
    if(!rows[0].email_verified_at) return res.status(403).json({error:'Verify your university email before using the portal.'});
    req.user=rows[0]; next();
  } catch(e){clearSession(res);return res.status(401).json({error:'Your session has expired. Please sign in again.'});}
});
const requireRole = (...roles) => (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'You do not have permission to perform this action.'});
const validEmail = email => typeof email==='string' && email.trim().toLowerCase().endsWith(DOMAIN) && /^[^\s@]+@students\.sau\.ac\.in$/i.test(email.trim());
const clean = v => typeof v==='string'?v.trim():'';
const upload = multer({storage:multer.diskStorage({destination:uploadDir,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:3*1024*1024},fileFilter:(req,file,cb)=>{const ok=['image/jpeg','image/png','image/webp'].includes(file.mimetype);cb(ok?null:new Error('Only JPG, PNG or WEBP images are allowed.'),ok);}});

async function sendVerificationEmail(email,token){
  const link=`${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/verify?token=${token}`;
  if(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
    const nodemailer=require('nodemailer');
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.SMTP_FROM,to:email,subject:'Verify your SAU student portal account',text:`Verify your account using this link (valid for 30 minutes): ${link}`});
  } else if(process.env.NODE_ENV!=='production') console.log(`\n[DEV EMAIL] Verification link for ${email}: ${link}\n`); else throw new Error('SMTP is required in production to send verification emails. Configure SMTP_HOST, SMTP_USER and SMTP_PASS.');
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'SAU Campus Portal API'}));
app.post('/api/auth/register',authLimiter,asyncRoute(async(req,res)=>{
  const name=clean(req.body.name),email=clean(req.body.email).toLowerCase(),password=req.body.password;
  if(name.length<2||name.length>100) return res.status(400).json({error:'Name must be between 2 and 100 characters.'});
  if(!validEmail(email)) return res.status(400).json({error:`Only university email addresses ending in ${DOMAIN} can register.`});
  if(typeof password!=='string'||password.length<10||password.length>128||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)) return res.status(400).json({error:'Password must be 10–128 characters and contain letters and numbers.'});
  const [existing]=await pool.execute('SELECT id FROM users WHERE email=?',[email]);
  if(existing.length) return res.status(409).json({error:'An account with this email already exists.'});
  const hash=await bcrypt.hash(password,12),token=crypto.randomBytes(32).toString('hex'),tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const [result]=await pool.execute('INSERT INTO users(name,email,password_hash,verification_token_hash,verification_expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE)) RETURNING id',[name,email,hash,tokenHash]);
  try{await sendVerificationEmail(email,token);}catch(e){await pool.execute('DELETE FROM users WHERE id=?',[result.insertId]);throw e;}
  res.status(201).json({message:'Account created. Check your university inbox for the verification link. You can sign in after verifying your email.'});
}));
app.get('/api/auth/verify',asyncRoute(async(req,res)=>{
  const token=clean(req.query.token);if(!token) return res.status(400).json({error:'Verification token is missing.'});
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const [rows]=await pool.execute('SELECT id FROM users WHERE verification_token_hash=? AND verification_expires_at>NOW()',[hash]);
  if(!rows.length) return res.status(400).json({error:'This verification link is invalid or expired. Please register again or contact an administrator.'});
  await pool.execute('UPDATE users SET email_verified_at=NOW(),verification_token_hash=NULL,verification_expires_at=NULL WHERE id=?',[rows[0].id]);
  res.redirect('/?verified=1');
}));
app.post('/api/auth/login',authLimiter,asyncRoute(async(req,res)=>{
  const email=clean(req.body.email).toLowerCase(),password=req.body.password;
  if(!validEmail(email)||typeof password!=='string') return res.status(400).json({error:`Use your ${DOMAIN} address and password.`});
  const [rows]=await pool.execute('SELECT id,name,email,password_hash,role,email_verified_at,is_active FROM users WHERE email=?',[email]);
  if(!rows.length||!rows[0].is_active||!(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:'Email or password is incorrect.'});
  const user=rows[0];if(!user.email_verified_at) return res.status(403).json({error:'Please verify your university email before signing in.'});
  issueSession(res,user);res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));
app.post('/api/auth/logout',(req,res)=>{clearSession(res);res.json({message:'Signed out.'});});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json({user:req.user}));

app.get('/api/clubs',asyncRoute(async(req,res)=>{
  const q=`SELECT c.id,c.name,c.category,c.description,c.focus,c.activities,c.recruitment_open,c.recruitment_deadline,u.name AS manager_name,
  (SELECT COUNT(*) FROM applications a WHERE a.club_id=c.id) AS application_count FROM clubs c LEFT JOIN users u ON u.id=c.manager_id ORDER BY c.name`;
  const [clubs]=await pool.query(q);res.json({clubs});
}));
app.get('/api/clubs/:id',asyncRoute(async(req,res)=>{
  const [clubs]=await pool.execute('SELECT id,name,category,description,focus,activities,recruitment_open,recruitment_deadline FROM clubs WHERE id=?',[req.params.id]);
  if(!clubs.length)return res.status(404).json({error:'Club not found.'});
  const [announcements]=await pool.execute('SELECT a.id,a.title,a.body,a.image_path,a.created_at,u.name AS author_name FROM announcements a JOIN users u ON u.id=a.author_id WHERE a.club_id=? ORDER BY a.created_at DESC LIMIT 10',[req.params.id]);
  const [quotes]=await pool.execute('SELECT id,quote_text,attribution,created_at FROM motivation_quotes WHERE club_id=? ORDER BY created_at DESC LIMIT 5',[req.params.id]);
  res.json({club:clubs[0],announcements,quotes});
}));
app.get('/api/feed',asyncRoute(async(req,res)=>{
 const [announcements]=await pool.query('SELECT a.id,a.title,a.body,a.image_path,a.created_at,c.id AS club_id,c.name AS club_name,u.name AS author_name FROM announcements a JOIN clubs c ON c.id=a.club_id JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC LIMIT 20');
 const [quotes]=await pool.query('SELECT q.id,q.quote_text,q.attribution,q.created_at,c.id AS club_id,c.name AS club_name FROM motivation_quotes q JOIN clubs c ON c.id=q.club_id ORDER BY q.created_at DESC LIMIT 12');
 res.json({announcements,quotes});
}));

app.post('/api/applications',requireAuth,requireRole('student'),asyncRoute(async(req,res)=>{
 const clubId=Number(req.body.clubId),course=clean(req.body.course),year=clean(req.body.academicYear),motivation=clean(req.body.motivation);
 if(!Number.isInteger(clubId)||course.length<2||course.length>120||year.length<1||year.length>30||motivation.length<30||motivation.length>3000) return res.status(400).json({error:'Complete all fields. Motivation must be 30–3000 characters.'});
 const [clubs]=await pool.execute('SELECT id FROM clubs WHERE id=? AND recruitment_open=TRUE',[clubId]);if(!clubs.length)return res.status(400).json({error:'This club is not currently accepting applications.'});
 try{const [r]=await pool.execute('INSERT INTO applications(student_id,club_id,course,academic_year,motivation) VALUES(?,?,?,?,?) RETURNING id',[req.user.id,clubId,course,year,motivation]);await pool.execute('INSERT INTO application_history(application_id,changed_by,old_status,new_status,note) VALUES(?,?,NULL,?,?)',[r.insertId,req.user.id,'submitted','Application submitted']);res.status(201).json({message:'Application submitted successfully.'});}
 catch(e){if(e.code==='23505'||e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'You have already applied to this club.'});throw e;}
}));
app.get('/api/applications/mine',requireAuth,requireRole('student'),asyncRoute(async(req,res)=>{
 const [applications]=await pool.execute(`SELECT a.id,a.course,a.academic_year,a.motivation,a.status,a.manager_note,a.submitted_at,a.updated_at,c.id AS club_id,c.name AS club_name,c.category FROM applications a JOIN clubs c ON c.id=a.club_id WHERE a.student_id=? ORDER BY a.submitted_at DESC`,[req.user.id]);
 for(const a of applications){const [history]=await pool.execute('SELECT old_status,new_status,note,created_at FROM application_history WHERE application_id=? ORDER BY created_at ASC',[a.id]);a.history=history;}
 res.json({applications});
}));
app.get('/api/applications/managed',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{
 let sql=`SELECT a.id,a.course,a.academic_year,a.motivation,a.status,a.manager_note,a.submitted_at,u.name AS student_name,u.email AS student_email,c.id AS club_id,c.name AS club_name FROM applications a JOIN users u ON u.id=a.student_id JOIN clubs c ON c.id=a.club_id`;
 const params=[];if(req.user.role==='manager'){sql+=' WHERE c.manager_id=?';params.push(req.user.id);}sql+=' ORDER BY a.submitted_at DESC';
 const [applications]=await pool.execute(sql,params);res.json({applications});
}));
app.patch('/api/applications/:id/status',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{
 const allowed=['under_review','shortlisted','interview_scheduled','selected','rejected'];const status=clean(req.body.status),note=clean(req.body.note).slice(0,1000);
 if(!allowed.includes(status))return res.status(400).json({error:'Invalid application status.'});
 const [rows]=await pool.execute(`SELECT a.id,a.status,c.manager_id FROM applications a JOIN clubs c ON c.id=a.club_id WHERE a.id=?`,[req.params.id]);if(!rows.length)return res.status(404).json({error:'Application not found.'});
 if(req.user.role==='manager'&&rows[0].manager_id!==req.user.id)return res.status(403).json({error:'You can only manage applications for your assigned club.'});
 await pool.execute('UPDATE applications SET status=?,manager_note=?,updated_at=NOW() WHERE id=?',[status,note||null,req.params.id]);
 await pool.execute('INSERT INTO application_history(application_id,changed_by,old_status,new_status,note) VALUES(?,?,?,?,?)',[req.params.id,req.user.id,rows[0].status,status,note||null]);res.json({message:'Application status updated.'});
}));
app.patch('/api/applications/:id/withdraw',requireAuth,requireRole('student'),asyncRoute(async(req,res)=>{
 const [r]=await pool.execute('SELECT status FROM applications WHERE id=? AND student_id=?',[req.params.id,req.user.id]);if(!r.length)return res.status(404).json({error:'Application not found.'});if(['selected','rejected','withdrawn'].includes(r[0].status))return res.status(400).json({error:'This application can no longer be withdrawn.'});
 await pool.execute("UPDATE applications SET status='withdrawn',updated_at=NOW() WHERE id=?",[req.params.id]);await pool.execute('INSERT INTO application_history(application_id,changed_by,old_status,new_status,note) VALUES(?,?,?,?,?)',[req.params.id,req.user.id,r[0].status,'withdrawn','Withdrawn by student']);res.json({message:'Application withdrawn.'});
}));

app.get('/api/saved',requireAuth,asyncRoute(async(req,res)=>{const [clubs]=await pool.execute('SELECT c.id,c.name,c.category,c.description FROM saved_clubs s JOIN clubs c ON c.id=s.club_id WHERE s.user_id=? ORDER BY s.created_at DESC',[req.user.id]);res.json({clubs});}));
app.post('/api/saved/:clubId',requireAuth,asyncRoute(async(req,res)=>{await pool.execute('INSERT INTO saved_clubs(user_id,club_id) VALUES(?,?) ON CONFLICT (user_id,club_id) DO NOTHING',[req.user.id,req.params.clubId]);res.json({message:'Club saved.'});}));
app.delete('/api/saved/:clubId',requireAuth,asyncRoute(async(req,res)=>{await pool.execute('DELETE FROM saved_clubs WHERE user_id=? AND club_id=?',[req.user.id,req.params.clubId]);res.json({message:'Club removed from saved list.'});}));

app.get('/api/manager/clubs',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{const [clubs]=req.user.role==='admin'?await pool.query('SELECT c.id,c.name,c.category,c.recruitment_open,c.manager_id,u.name AS manager_name FROM clubs c LEFT JOIN users u ON u.id=c.manager_id ORDER BY c.name'):await pool.execute('SELECT id,name,category,recruitment_open,manager_id FROM clubs WHERE manager_id=?',[req.user.id]);res.json({clubs});}));
app.post('/api/manager/announcements',requireAuth,requireRole('manager','admin'),upload.single('image'),asyncRoute(async(req,res)=>{
 const clubId=Number(req.body.clubId),title=clean(req.body.title),body=clean(req.body.body);if(title.length<4||title.length>180||body.length<5||body.length>5000)return res.status(400).json({error:'Enter a title (4–180 characters) and announcement (5–5000 characters).'});
 const [clubs]=await pool.execute('SELECT id,manager_id FROM clubs WHERE id=?',[clubId]);if(!clubs.length)return res.status(404).json({error:'Club not found.'});if(req.user.role==='manager'&&clubs[0].manager_id!==req.user.id)return res.status(403).json({error:'You can only post for your assigned club.'});
 const imagePath=req.file?`/uploads/${req.file.filename}`:null;await pool.execute('INSERT INTO announcements(club_id,author_id,title,body,image_path) VALUES(?,?,?,?,?)',[clubId,req.user.id,title,body,imagePath]);res.status(201).json({message:'Announcement published.'});
}));
app.post('/api/manager/quotes',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{
 const clubId=Number(req.body.clubId),quote=clean(req.body.quote),attribution=clean(req.body.attribution).slice(0,120);if(quote.length<8||quote.length>500)return res.status(400).json({error:'Quote must be between 8 and 500 characters.'});
 const [clubs]=await pool.execute('SELECT id,manager_id FROM clubs WHERE id=?',[clubId]);if(!clubs.length)return res.status(404).json({error:'Club not found.'});if(req.user.role==='manager'&&clubs[0].manager_id!==req.user.id)return res.status(403).json({error:'You can only post for your assigned club.'});
 await pool.execute('INSERT INTO motivation_quotes(club_id,author_id,quote_text,attribution) VALUES(?,?,?,?)',[clubId,req.user.id,quote,attribution||null]);res.status(201).json({message:'Motivation quote published.'});
}));
app.delete('/api/manager/announcements/:id',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{
 const [rows]=await pool.execute('SELECT a.id,a.image_path,c.manager_id FROM announcements a JOIN clubs c ON c.id=a.club_id WHERE a.id=?',[req.params.id]);if(!rows.length)return res.status(404).json({error:'Announcement not found.'});if(req.user.role==='manager'&&rows[0].manager_id!==req.user.id)return res.status(403).json({error:'Not your club announcement.'});await pool.execute('DELETE FROM announcements WHERE id=?',[req.params.id]);if(rows[0].image_path){const p=path.join(__dirname,rows[0].image_path.replace(/^\//,''));fs.rm(p,{force:true},()=>{});}res.json({message:'Announcement deleted.'});
}));
app.delete('/api/manager/quotes/:id',requireAuth,requireRole('manager','admin'),asyncRoute(async(req,res)=>{const [r]=await pool.execute('SELECT q.id,c.manager_id FROM motivation_quotes q JOIN clubs c ON c.id=q.club_id WHERE q.id=?',[req.params.id]);if(!r.length)return res.status(404).json({error:'Quote not found.'});if(req.user.role==='manager'&&r[0].manager_id!==req.user.id)return res.status(403).json({error:'Not your club quote.'});await pool.execute('DELETE FROM motivation_quotes WHERE id=?',[req.params.id]);res.json({message:'Quote deleted.'});}));

app.get('/api/admin/overview',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{
 const [[{students}]] = await pool.query("SELECT COUNT(*) AS students FROM users WHERE role='student'");const [[{managers}]]=await pool.query("SELECT COUNT(*) AS managers FROM users WHERE role='manager'");const [[{clubs}]]=await pool.query('SELECT COUNT(*) AS clubs FROM clubs');const [[{applications}]]=await pool.query('SELECT COUNT(*) AS applications FROM applications');const [[{pending}]]=await pool.query("SELECT COUNT(*) AS pending FROM applications WHERE status IN ('submitted','under_review')");res.json({stats:{students,managers,clubs,applications,pending}});
}));
app.get('/api/admin/users',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{const [users]=await pool.query('SELECT id,name,email,role,is_active,email_verified_at,created_at FROM users ORDER BY created_at DESC LIMIT 500');res.json({users});}));
app.patch('/api/admin/users/:id/role',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{
 const role=clean(req.body.role);if(!['student','manager'].includes(role))return res.status(400).json({error:'Role must be student or manager.'});if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'You cannot change your own role.'});const [r]=await pool.execute('UPDATE users SET role=? WHERE id=? AND role<>\'admin\'',[role,req.params.id]);if(!r.affectedRows)return res.status(404).json({error:'User not found or cannot be changed.'});if(role==='student')await pool.execute('UPDATE clubs SET manager_id=NULL WHERE manager_id=?',[req.params.id]);res.json({message:'User role updated.'});
}));
app.patch('/api/admin/clubs/:id/manager',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{
 const managerId=req.body.managerId?Number(req.body.managerId):null;if(managerId){const [m]=await pool.execute("SELECT id FROM users WHERE id=? AND role='manager' AND is_active=1 AND email_verified_at IS NOT NULL",[managerId]);if(!m.length)return res.status(400).json({error:'Select an active, verified club manager.'});}const [exists]=await pool.execute('SELECT id FROM clubs WHERE id=?',[req.params.id]);if(!exists.length)return res.status(404).json({error:'Club not found.'});await pool.execute('UPDATE clubs SET manager_id=?,updated_at=NOW() WHERE id=?',[managerId,req.params.id]);res.json({message:'Club manager assignment updated.'});
}));
app.post('/api/admin/clubs',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{const name=clean(req.body.name),category=clean(req.body.category),description=clean(req.body.description),focus=clean(req.body.focus),activities=clean(req.body.activities);if(name.length<3||name.length>120||!['tech','arts','sports','social','other'].includes(category)||description.length<10)return res.status(400).json({error:'Provide a valid club name, category and description.'});try{const [r]=await pool.execute('INSERT INTO clubs(name,category,description,focus,activities) VALUES(?,?,?,?,?) RETURNING id',[name,category,description,focus,activities]);res.status(201).json({message:'Club created.',id:r.insertId});}catch(e){if(e.code==='23505'||e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'A club with this name already exists.'});throw e;}}));
app.patch('/api/admin/clubs/:id',requireAuth,requireRole('admin'),asyncRoute(async(req,res)=>{const open=Boolean(req.body.recruitmentOpen);const [exists]=await pool.execute('SELECT id FROM clubs WHERE id=?',[req.params.id]);if(!exists.length)return res.status(404).json({error:'Club not found.'});await pool.execute('UPDATE clubs SET recruitment_open=?,updated_at=NOW() WHERE id=?',[open,req.params.id]);res.json({message:'Recruitment settings updated.'});}));

app.get('/verify-email',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use((err,req,res,next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({error:err.message});res.status(500).json({error:process.env.NODE_ENV==='production'?'An unexpected server error occurred.':'Server error: '+err.message});});

(async()=>{
  try {
    await pgPool.query('SELECT 1');
    app.listen(PORT,()=>console.log(`SAU Campus Portal running at http://localhost:${PORT}`));
  } catch(e) {
    console.error('CockroachDB connection failed. Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and TLS settings in .env.', e.message);
    await pgPool.end().catch(()=>{});
    process.exit(1);
  }
})();

process.on('SIGINT', async()=>{ await pgPool.end(); process.exit(0); });
process.on('SIGTERM', async()=>{ await pgPool.end(); process.exit(0); });
