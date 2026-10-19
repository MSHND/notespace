"""P349 disposable browser-only approval prototype. NOT a production service.
Synthetic localhost-only identity, SQLite receipt store, actual ES256 WebAuthn
assertion verification. No Pocket/Sync imports, PRF, deploy or publication.
"""
import base64, hashlib, json, secrets, sqlite3, struct, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes

RP = 'localhost'
DOCS = ('Overview','Ownership','Process','Testing','Security','Assurance','Operations','Recovery','Release notes')

def b64(b):return base64.urlsafe_b64encode(b).decode().rstrip('=')
def ub64(s):return base64.urlsafe_b64decode(s+'='*((-len(s))%4))
def sha(b):return hashlib.sha256(b).hexdigest()

def cbor(data, pos=0):
    start=pos; first=data[pos];pos+=1; major=first>>5; info=first&31
    if info<24:n=info
    elif info==24:n=data[pos];pos+=1
    elif info==25:n=int.from_bytes(data[pos:pos+2],'big');pos+=2
    elif info==26:n=int.from_bytes(data[pos:pos+4],'big');pos+=4
    elif info==27:n=int.from_bytes(data[pos:pos+8],'big');pos+=8
    else:raise ValueError('indefinite CBOR unsupported')
    if major==0:return n,pos
    if major==1:return -1-n,pos
    if major in (2,3):
        x=data[pos:pos+n];return (bytes(x) if major==2 else x.decode()),pos+n
    if major==4:
        a=[]
        for _ in range(n):x,pos=cbor(data,pos);a.append(x)
        return a,pos
    if major==5:
        a={}
        for _ in range(n): k,pos=cbor(data,pos);v,pos=cbor(data,pos);a[k]=v
        return a,pos
    raise ValueError('CBOR type not supported: '+str(major))

PAGE='''<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Review Pocket release — disposable test</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#24352e;background:#f2f5f0}*{box-sizing:border-box}body{margin:0}main{max-width:680px;margin:32px auto;padding:0 18px}.panel{background:white;border:1px solid #c5d3c8;border-radius:16px;padding:24px}h1{font-size:1.65rem;margin:4px 0 12px}h2{font-size:1.08rem}p,li{line-height:1.55}ul{padding-left:22px}.sub{color:#536d5f}.tag{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}button{font:inherit;border-radius:9px;padding:13px 18px;border:2px solid #28533d;cursor:pointer}button:focus-visible{outline:4px solid #bb6d17;outline-offset:3px}.primary{background:#28533d;color:white}.secondary{background:white;color:#28533d}button:disabled{opacity:.55;cursor:wait}.buttons{display:flex;gap:12px;flex-wrap:wrap}.status{border-left:5px solid #28533d;padding:12px;background:#eaf0e8;margin:16px 0}code{overflow-wrap:anywhere}details{margin:16px 0}#message{min-height:25px}
</style></head><body><main><section class="panel"><div class="tag">Disposable Pocket proof — synthetic data</div><h1>Publish this Pocket release?</h1>
<p>You are confirming that the nine checked handover documents below become the proposed release. This test <strong>does not publish anything</strong>.</p>
<p id="release" class="sub" aria-live="polite">Loading review…</p>
<h2>What you are approving</h2><ul id="docs"></ul>
<p id="revision"></p><details><summary>Technical fingerprint (optional)</summary><code id="fingerprint"></code></details>
<div class="buttons"><button class="primary" id="confirm" type="button">Confirm with passkey</button><button class="secondary" id="cancel" type="button">Cancel</button></div>
<div class="status" role="status" aria-live="polite" id="message">Review the details before deciding.</div>
</section></main><script>
const el=id=>document.getElementById(id);
const from64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const to64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const api=async(url,body)=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});return r.json()};
let review;
async function init(){ review=await api('/api/review');el('release').textContent=`Release ${review.releaseId} for ${review.ownerLabel}`;
 el('revision').textContent=`Current revision ${review.expectedRevision}. If published later, the new revision would be ${review.expectedRevision+1}.`;
 const ul=el('docs');review.docs.forEach(doc=>{const li=document.createElement('li');li.textContent=doc.name;ul.append(li)});
 el('fingerprint').textContent=review.manifestSha256;
 if(review.status==='APPROVED'){el('message').textContent='Already confirmed. One approval receipt exists.';el('confirm').disabled=true;}
 else if(review.status==='CANCELLED'){el('message').textContent='Cancelled. Nothing was approved.';el('confirm').disabled=true;}
 else if(review.status==='EXPIRED'){el('message').textContent='Expired. No approval was made.';el('confirm').disabled=true;}
}
async function confirm(){el('confirm').disabled=true;el('message').textContent='Waiting for passkey confirmation…';
 try{const begin=await api('/api/begin',{});if(begin.status!=='READY'){el('message').textContent=begin.message||begin.status;return;}
 const opts={challenge:from64(begin.challenge),rpId:begin.rpId,allowCredentials:begin.allowCredentials.map(c=>({type:'public-key',id:from64(c.id)})),userVerification:'required',timeout:45000};
 // There is deliberately NO extensions or PRF request.
 const cred=await navigator.credentials.get({publicKey:opts});
 const payload={id:cred.id,rawId:to64(cred.rawId),type:cred.type,response:{clientDataJSON:to64(cred.response.clientDataJSON),authenticatorData:to64(cred.response.authenticatorData),signature:to64(cred.response.signature),userHandle:cred.response.userHandle?to64(cred.response.userHandle):null},challengeId:begin.challengeId};
 const out=await api('/api/complete',payload);
 el('message').textContent=out.status==='APPROVED'?'Confirmed. Exactly one approval receipt was created.':out.status==='ALREADY_CONFIRMED'?'Already confirmed. No second receipt was created.':out.status==='EXPIRED'?'Expired. Nothing was approved.':out.status==='DENIED'?'Denied. No approval was created.':out.status;
 if(!['APPROVED','ALREADY_CONFIRMED'].includes(out.status))el('confirm').disabled=false;
 }catch(e){el('message').textContent=e.name==='NotAllowedError'?'Passkey cancelled or unavailable. Nothing was approved.':'Denied. No approval was created.';el('confirm').disabled=false;}}
el('confirm').addEventListener('click',confirm);el('cancel').addEventListener('click',async()=>{const v=await api('/api/cancel',{});el('message').textContent=v.status==='CANCELLED'?'Cancelled. Nothing was approved.':v.status;el('confirm').disabled=true;});init();
</script></body></html>'''

class App:
 def __init__(self,dbfile,origin):
  self.dbfile=str(dbfile);self.origin=origin;self.lock=threading.RLock();self.fail_before=False;self.lose_after=False;self.clock_offset=0;self.no_verifier_calls=0
  self._init()
 def now(self):return time.time()+self.clock_offset
 def conn(self):
  c=sqlite3.connect(self.dbfile,timeout=5,isolation_level=None,check_same_thread=False);c.row_factory=sqlite3.Row;c.execute('PRAGMA busy_timeout=5000');return c
 def _init(self):
  with self.conn() as c:
   c.executescript('''CREATE TABLE accounts(id TEXT PRIMARY KEY,active INTEGER NOT NULL);
    CREATE TABLE session(token TEXT PRIMARY KEY,account TEXT NOT NULL);
    CREATE TABLE grants(account TEXT,resource TEXT,allowed INTEGER,PRIMARY KEY(account,resource));
    CREATE TABLE credential(id TEXT PRIMARY KEY,account TEXT NOT NULL,public_x BLOB NOT NULL, public_y BLOB NOT NULL,counter INTEGER NOT NULL,backup_eligible INTEGER NOT NULL,backup_state INTEGER NOT NULL);
    CREATE TABLE intent(id TEXT PRIMARY KEY,account TEXT,owner TEXT,resource TEXT,release TEXT,expected_rev INTEGER,docs TEXT,manifest TEXT,expires REAL,status TEXT NOT NULL);
    CREATE TABLE challenge(id TEXT PRIMARY KEY,intent_id TEXT,account TEXT,nonce TEXT NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE receipts(id TEXT PRIMARY KEY,intent_id TEXT UNIQUE NOT NULL,account TEXT,manifest TEXT,created REAL,status TEXT NOT NULL);''')
   c.execute("INSERT INTO accounts VALUES('acct-alice',1)");c.execute("INSERT INTO accounts VALUES('acct-bob',1)")
   c.execute("INSERT INTO grants VALUES('acct-alice','synthetic-handover',1)")
   c.execute("INSERT INTO grants VALUES('acct-bob','synthetic-handover',0)")
   docs=[{'name':n,'id':'doc-'+str(i+1),'sha256':sha(('synthetic:'+n).encode())} for i,n in enumerate(DOCS)]
   manifest=sha(json.dumps(docs,sort_keys=True,separators=(',',':')).encode())
   c.execute('INSERT INTO intent VALUES(?,?,?,?,?,?,?,?,?,?)',('ceremony-p349','acct-alice','owner-alice','synthetic-handover','synthetic-release-17',7,json.dumps(docs),manifest,self.now()+3600,'OPEN'))
   for acct in ('alice','bob'):
    c.execute('INSERT INTO session VALUES(?,?)',('session-'+acct,'acct-'+acct))
 def session(self,headers):
  token='';parts=headers.get('Cookie','').split(';')
  for part in parts:
   if part.strip().startswith('p349test='):token=part.strip().split('=',1)[1]
  with self.conn() as c:
   v=c.execute('SELECT account FROM session WHERE token=?',(token,)).fetchone()
   return v['account'] if v else None
 def current(self,c):return c.execute("SELECT * FROM intent WHERE id='ceremony-p349'").fetchone()
 def authorized(self,c,acct,r):
  a=c.execute('SELECT active FROM accounts WHERE id=?',(acct,)).fetchone()
  g=c.execute('SELECT allowed FROM grants WHERE account=? AND resource=?',(acct,r['resource'])).fetchone()
  return bool(a and a['active'] and g and g['allowed'] and r['account']==acct)
 def review(self,acct):
  with self.conn() as c:
   r=self.current(c)
   if not self.authorized(c,acct,r):return {'status':'DENIED'}
   status=r['status'] if self.now()<r['expires'] else 'EXPIRED'
   return {'status':status,'ownerLabel':'synthetic Alice','releaseId':r['release'],'expectedRevision':r['expected_rev'],'docs':json.loads(r['docs']),'manifestSha256':r['manifest']}
 def begin(self,acct):
  with self.lock,self.conn() as c:
   c.execute('BEGIN IMMEDIATE');r=self.current(c)
   if not self.authorized(c,acct,r):return {'status':'DENIED'}
   if r['status']=='APPROVED':return {'status':'ALREADY_CONFIRMED','message':'Already confirmed'}
   if r['status']=='CANCELLED':return {'status':'CANCELLED','message':'Cancelled'}
   if self.now()>=r['expires']:return {'status':'EXPIRED','message':'Expired'}
   creds=c.execute('SELECT id FROM credential WHERE account=?',(acct,)).fetchall()
   if not creds:return {'status':'DENIED'}
   ch=b64(secrets.token_bytes(32));cid='challenge-'+secrets.token_hex(16)
   c.execute('INSERT INTO challenge(id,intent_id,account,nonce,expires) VALUES(?,?,?,?,?)',(cid,r['id'],acct,ch,min(self.now()+90,r['expires'])))
   return {'status':'READY','challengeId':cid,'challenge':ch,'rpId':RP,'allowCredentials':[{'id':x['id']} for x in creds]}
 def complete(self,acct,data):
  if not isinstance(data,dict) or set(data)!={'id','rawId','type','response','challengeId'}:return {'status':'DENIED'}
  try:
   if data['type']!='public-key' or data['id']!=data['rawId']:return {'status':'DENIED'}
   response=data['response']; assert set(response)=={'clientDataJSON','authenticatorData','signature','userHandle'}
   raw=ub64(response['clientDataJSON']);cd=json.loads(raw);ad=ub64(response['authenticatorData']);sig=ub64(response['signature'])
   assert cd['type']=='webauthn.get' and isinstance(data['challengeId'],str)
   if len(ad)<37 or len(sig)>256:return {'status':'DENIED'}
  except Exception:return {'status':'DENIED'}
  with self.lock,self.conn() as c:
   try:
    c.execute('BEGIN IMMEDIATE');r=self.current(c)
    if not self.authorized(c,acct,r):return {'status':'DENIED'}
    if r['status']=='APPROVED':return {'status':'ALREADY_CONFIRMED'}
    if r['status']!='OPEN' or self.now()>=r['expires']:return {'status':'EXPIRED' if self.now()>=r['expires'] else 'DENIED'}
    challenge=c.execute('SELECT * FROM challenge WHERE id=?',(data['challengeId'],)).fetchone()
    if not challenge or challenge['used'] or challenge['intent_id']!=r['id'] or challenge['account']!=acct or self.now()>=challenge['expires']:return {'status':'DENIED'}
    credential=c.execute('SELECT * FROM credential WHERE id=?',(data['id'],)).fetchone()
    if not credential or credential['account']!=acct:return {'status':'DENIED'}
    if cd.get('challenge')!=challenge['nonce'] or cd.get('origin')!=self.origin or cd.get('crossOrigin',False):return {'status':'DENIED'}
    if ad[:32]!=hashlib.sha256(RP.encode()).digest():return {'status':'DENIED'}
    flags=ad[32];up=bool(flags&0x01);uv=bool(flags&0x04);be=bool(flags&0x08);bs=bool(flags&0x10)
    if not up or not uv or bs and not be or be!=bool(credential['backup_eligible']):return {'status':'DENIED'}
    signcount=struct.unpack('>I',ad[33:37])[0]
    if signcount or credential['counter']:
     if signcount<=credential['counter']:return {'status':'DENIED'}
    key=ec.EllipticCurvePublicNumbers(int.from_bytes(credential['public_x'],'big'),int.from_bytes(credential['public_y'],'big'),ec.SECP256R1()).public_key()
    try:key.verify(sig,ad+hashlib.sha256(raw).digest(),ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:return {'status':'DENIED'}
    self.no_verifier_calls+=1
    c.execute('UPDATE challenge SET used=1 WHERE id=? AND used=0',(challenge['id'],))
    c.execute('UPDATE credential SET counter=?,backup_state=? WHERE id=?',(signcount,int(bs),credential['id']))
    if self.fail_before:raise RuntimeError('simulated failure BEFORE durable receipt')
    receipt_id='approved-'+secrets.token_hex(12)
    c.execute('INSERT INTO receipts VALUES(?,?,?,?,?,?)',(receipt_id,r['id'],acct,r['manifest'],self.now(),'APPROVED'))
    c.execute("UPDATE intent SET status='APPROVED' WHERE id=? AND status='OPEN'",(r['id'],))
    c.execute('COMMIT')
    if self.lose_after:return {'status':'UNKNOWN'}
    return {'status':'APPROVED'}
   except Exception:
    c.execute('ROLLBACK');return {'status':'UNKNOWN'}
 def cancel(self,acct):
  with self.lock,self.conn() as c:
   c.execute('BEGIN IMMEDIATE');r=self.current(c)
   if not self.authorized(c,acct,r):return {'status':'DENIED'}
   if r['status']=='APPROVED':return {'status':'ALREADY_CONFIRMED'}
   c.execute("UPDATE intent SET status='CANCELLED' WHERE id=? AND status='OPEN'",(r['id'],))
   return {'status':'CANCELLED'}
 def registration(self,acct):
  # Synthetic test fixture only. Never displayed in owner review flow.
  return {'challenge':b64(secrets.token_bytes(32)),'rp':{'id':RP,'name':'Disposable Pocket proof'},'user':{'id':b64(acct.encode()),'name':acct,'displayName':acct},'pubKeyCredParams':[{'type':'public-key','alg':-7}],'attestation':'none','authenticatorSelection':{'userVerification':'required','residentKey':'preferred'}}
 def register(self,acct,data):
  try:
   att=ub64(data['response']['attestationObject']);obj,_=cbor(att);ad=obj['authData']
   if obj['fmt']!='none' or ad[:32]!=hashlib.sha256(RP.encode()).digest():return {'status':'DENIED'}
   flags=ad[32];assert flags&1 and flags&4 and flags&0x40
   pos=37+16;length=int.from_bytes(ad[pos:pos+2],'big');pos+=2
   credid=b64(ad[pos:pos+length]);pos+=length
   pub,pos=cbor(ad,pos);assert pub[1]==2 and pub[3]==-7 and pub[-1]==1
   x,y=pub[-2],pub[-3]
   assert len(x)==len(y)==32 and credid==data['id']
   with self.lock,self.conn() as c:
    c.execute('INSERT INTO credential(id,account,public_x,public_y,counter,backup_eligible,backup_state) VALUES(?,?,?,?,?,?,?)',(credid,acct,x,y,struct.unpack('>I',ad[33:37])[0],int(bool(flags&8)),int(bool(flags&16))))
   return {'status':'REGISTERED','id':credid}
  except Exception as e:return {'status':'DENIED','reason':str(e)[:70]}

class Server(ThreadingHTTPServer):
 def __init__(self,addr,app):super().__init__(addr,Handler);self.app=app
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def response(self,obj,status=200):
  data=json.dumps(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_GET(self):
  if self.path=='/':
   data=PAGE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");self.end_headers();self.wfile.write(data);return
  if self.path=='/api/review':return self.response(self.server.app.review(self.server.app.session(self.headers)))
  self.response({'status':'NOT_FOUND'},404)
 def do_POST(self):
  if self.headers.get('Origin')!=self.server.app.origin:return self.response({'status':'DENIED'},403)
  if self.headers.get('Content-Type')!='application/json':return self.response({'status':'DENIED'},415)
  length=int(self.headers.get('Content-Length',0));
  if not 0<=length<=8192:return self.response({'status':'DENIED'},413)
  try:data=json.loads(self.rfile.read(length))
  except:return self.response({'status':'DENIED'},400)
  acct=self.server.app.session(self.headers)
  if self.path=='/api/begin':return self.response(self.server.app.begin(acct))
  if self.path=='/api/complete':return self.response(self.server.app.complete(acct,data))
  if self.path=='/api/cancel':return self.response(self.server.app.cancel(acct))
  # Synthetic registration endpoint; no real accounts or passkeys.
  if self.path=='/__test/register-options':return self.response(self.server.app.registration(acct))
  if self.path=='/__test/register-finish':return self.response(self.server.app.register(acct,data))
  self.response({'status':'NOT_FOUND'},404)
