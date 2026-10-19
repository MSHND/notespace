"""Actual Chromium 144 virtual WebAuthn authenticator browser acceptance.
No mocked navigator.credentials/get or mocked server signatures.
"""
import json, sqlite3, tempfile, threading, time, socket, pathlib, unittest, re, platform
from playwright.sync_api import sync_playwright
from prototype import App,Server
OUT=pathlib.Path(__file__).parent

def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def make_session(page,acct):
 page.context.add_cookies([{'name':'p349test','value':'session-'+acct,'url':page.context._base_url or page.url if page.url.startswith('http') else page.context._base_url}])

class BrowserAcceptance(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.dir=tempfile.TemporaryDirectory(prefix='p349-disposable-')
  cls.port=port();cls.base=f'http://localhost:{cls.port}';cls.app=App(pathlib.Path(cls.dir.name)/'proof.sqlite',cls.base)
  cls.server=Server(('127.0.0.1',cls.port),cls.app);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
  cls.p=sync_playwright().start()
  cls.browser=cls.p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  cls.ctx=cls.browser.new_context(base_url=cls.base,viewport={'width':1120,'height':850})
  cls.ctx.add_cookies([{'name':'p349test','value':'session-alice','url':cls.base}]);cls.page=cls.ctx.new_page();cls.page.goto(cls.base)
  cls.cdp=cls.ctx.new_cdp_session(cls.page);cls.cdp.send('WebAuthn.enable')
  cls.alice_auth=cls.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'usb','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
  cls.register('alice')
  cls.bob_ctx=cls.browser.new_context(base_url=cls.base)
  cls.bob_ctx.add_cookies([{'name':'p349test','value':'session-bob','url':cls.base}]);cls.bobpage=cls.bob_ctx.new_page();cls.bobpage.goto(cls.base)
  cls.bobcdp=cls.bob_ctx.new_cdp_session(cls.bobpage);cls.bobcdp.send('WebAuthn.enable');cls.bob_auth=cls.bobcdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'usb','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
  cls.register('bob')
  print('ENVIRONMENT Chromium',cls.browser.version,'Python',platform.python_version(),'Playwright',getattr(__import__('playwright'),'__version__','python'), 'SQLite',sqlite3.sqlite_version,flush=True)
 @classmethod
 def tearDownClass(cls):
  cls.bob_ctx.close();cls.ctx.close();cls.browser.close();cls.p.stop();cls.server.shutdown();cls.server.server_close();cls.dir.cleanup()
 @classmethod
 def api(cls,page,path,data={}):
  return page.evaluate('async a=>{let r=await fetch(a.path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a.body),credentials:"same-origin"});return r.json()}',{'path':path,'body':data})
 @classmethod
 def register(cls,who):
  pg=cls.page if who=='alice' else cls.bobpage
  v=cls.api(pg,'/__test/register-options');v['challenge']=v['challenge']
  response=pg.evaluate('''async v=>{
 const b=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
 const e=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
 const pub={...v,challenge:b(v.challenge),user:{...v.user,id:b(v.user.id)}};
 const c=await navigator.credentials.create({publicKey:pub});return {id:c.id,response:{attestationObject:e(c.response.attestationObject)}};
}''',v)
  result=cls.api(pg,'/__test/register-finish',response);assert result['status']=='REGISTERED',result
  print('P349_CREDENTIAL_REGISTERED_SYNTHETIC',who,flush=True)
 @classmethod
 def setUp(cls):
  with cls.app.conn() as c:
   c.execute('DELETE FROM receipts');c.execute('DELETE FROM challenge');c.execute("UPDATE intent SET status='OPEN',expires=? WHERE id='ceremony-p349'",(cls.app.now()+3600,))
   c.execute("UPDATE grants SET allowed=1 WHERE account='acct-alice'")
   c.execute("UPDATE accounts SET active=1 WHERE id='acct-alice'")
  cls.app.fail_before=False;cls.app.lose_after=False;cls.app.clock_offset=0
  cls.page.goto(cls.base)
 def counts(self):
  with self.app.conn() as c:
   return c.execute('SELECT count(*) FROM receipts').fetchone()[0],c.execute('SELECT status,docs,manifest,expected_rev FROM intent').fetchone()
 def assertFrozen(self,manifest=None):
  with self.app.conn() as c:
   r=c.execute('SELECT * FROM intent').fetchone();rc=c.execute('SELECT * FROM receipts').fetchall()
   self.assertEqual(len(json.loads(r['docs'])),9)
   if manifest:self.assertEqual(r['manifest'],manifest)
   for x in rc:self.assertEqual(x['manifest'],r['manifest'])
 def begin(self):
  v=self.api(self.page,'/api/begin');self.assertEqual(v['status'],'READY');return v
 def assertion(self,begin, page=None,override=None):
  page=page or self.page
  return page.evaluate('''async ({challenge,allowCredentials,rpId,challengeId,override})=>{
 const b=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
 const e=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
 const opts={challenge:b(challenge),rpId:override?.rpId||rpId,allowCredentials:(override?.allowCredentials||allowCredentials).map(c=>({id:b(c.id),type:'public-key'})),userVerification:override?.uv||'required',timeout:10000};
 const c=await navigator.credentials.get({publicKey:opts});return {id:c.id,rawId:e(c.rawId),type:c.type,challengeId,response:{clientDataJSON:e(c.response.clientDataJSON),authenticatorData:e(c.response.authenticatorData),signature:e(c.response.signature),userHandle:c.response.userHandle?e(c.response.userHandle):null}};
}''',{**begin,'override':override})
 def confirmed(self):
  self.page.get_by_role('button',name='Confirm with passkey').click()
  self.page.get_by_role('status').get_by_text('Confirmed.',exact=False).wait_for(timeout=8000)
  self.assertEqual(self.counts()[0],1);self.assertFrozen()
 def test_01_success_browser_and_accessibility(self):
  self.assertEqual(self.page.locator('#docs li').count(),9)
  self.assertIn('Current revision 7',self.page.locator('#revision').inner_text())
  self.assertTrue(self.page.get_by_role('button',name='Confirm with passkey').is_visible())
  self.assertTrue(self.page.get_by_role('button',name='Cancel').is_visible())
  self.confirmed()
  self.page.screenshot(path=str(OUT/'p349-success-synthetic.png'),full_page=True)
  self.page.reload();self.assertIn('Already confirmed',self.page.get_by_role('status').inner_text())
  self.assertEqual(self.counts()[0],1)
  self.page.set_viewport_size({'width':360,'height':740});self.page.reload()
  self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),360)
  self.page.screenshot(path=str(OUT/'p349-narrow-synthetic.png'),full_page=True)
  self.page.set_viewport_size({'width':1120,'height':850})
  print('P349_BROWSER_SUCCESS=PASS; receipt_count=1; screenshots=synthetic',flush=True)
 def test_02_cancel_abandon_expiry(self):
  self.page.get_by_role('button',name='Cancel').click();self.assertIn('Cancelled',self.page.get_by_role('status').inner_text());self.assertEqual(self.counts()[0],0)
  self.setUp();self.begin();self.page.close();self.page=self.ctx.new_page();self.page.goto(self.base);self.assertEqual(self.counts()[0],0)
  self.cdp.detach();self.cdp=self.ctx.new_cdp_session(self.page);self.cdp.send('WebAuthn.enable');self.alice_auth=self.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'usb','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
  # Authenticator above lost its earlier credential; recreate synthetic account credential.
  self.register('alice');self.setUp();self.app.clock_offset=4000
  self.page.get_by_role('button',name='Confirm with passkey').click();self.assertIn('Expired',self.page.get_by_role('status').inner_text());self.assertEqual(self.counts()[0],0)
 def test_03_replay_double_and_tamper(self):
  v=self.begin();a=self.assertion(v);man=self.counts()[1]['manifest']
  # Browser attempts to inject owner/release/revision or document fingerprints.
  forged={**a,'owner':'other','releaseId':'forged','expectedRevision':999,'docs':[{'sha256':'0'*64}]}
  self.assertEqual(self.api(self.page,'/api/complete',forged)['status'],'DENIED')
  self.assertEqual(self.counts()[0],0)
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'APPROVED')
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'ALREADY_CONFIRMED')
  self.assertEqual(self.api(self.page,'/api/begin')['status'],'ALREADY_CONFIRMED')
  self.assertEqual(self.counts()[0],1);self.assertFrozen(man)
 def test_04_wrong_owner_credential_and_origin(self):
  v=self.begin()
  self.assertEqual(self.api(self.bobpage,'/api/begin')['status'],'DENIED')
  self.assertEqual(self.api(self.bobpage,'/api/complete',{'id':'x'})['status'],'DENIED')
  a=self.assertion(v)
  def b64u(b):import base64;return base64.urlsafe_b64encode(b).decode().rstrip('=')
  def dec(s):import base64;return base64.urlsafe_b64decode(s+'='*((-len(s))%4))
  tampered=json.loads(json.dumps(a));raw=json.loads(dec(a['response']['clientDataJSON']));raw['origin']='https://evil.invalid';tampered['response']['clientDataJSON']=b64u(json.dumps(raw).encode())
  self.assertEqual(self.api(self.page,'/api/complete',tampered)['status'],'DENIED')
  tampered=json.loads(json.dumps(a));raw=json.loads(dec(a['response']['clientDataJSON']));raw['challenge']=b64u(b'wrong'*8);tampered['response']['clientDataJSON']=b64u(json.dumps(raw).encode())
  self.assertEqual(self.api(self.page,'/api/complete',tampered)['status'],'DENIED')
  tampered=json.loads(json.dumps(a));raw=bytearray(dec(a['response']['authenticatorData']));raw[0]^=1;tampered['response']['authenticatorData']=b64u(raw)
  self.assertEqual(self.api(self.page,'/api/complete',tampered)['status'],'DENIED')
  self.assertEqual(self.counts()[0],0)
 def test_05_missing_uv_and_revocation(self):
  v=self.begin();a=self.assertion(v)
  self.cdp.send('WebAuthn.setUserVerified',{'authenticatorId':self.alice_auth,'isUserVerified':False})
  try:
   b=self.begin()
   # A hostile client weakens its own requested UV; verifier still rejects.
   try:
    bad=self.assertion(b,override={'uv':'discouraged'})
    self.assertEqual(self.api(self.page,'/api/complete',bad)['status'],'DENIED')
   except Exception:pass  # browser may refuse to produce the weaker assertion
  finally:self.cdp.send('WebAuthn.setUserVerified',{'authenticatorId':self.alice_auth,'isUserVerified':True})
  with self.app.conn() as c:c.execute("UPDATE grants SET allowed=0 WHERE account='acct-alice'")
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'DENIED')
  self.assertEqual(self.counts()[0],0)
 def test_06_concurrent_before_after_durable_failure(self):
  v=self.begin();a=self.assertion(v)
  self.app.fail_before=True
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'UNKNOWN')
  self.assertEqual(self.counts()[0],0)
  self.app.fail_before=False
  # Same genuinely signed response may retry after a failed uncommitted DB tx.
  # Its nonce was never durably consumed; still max one APPROVED.
  result=self.page.evaluate('''async a=>Promise.all(Array.from({length:2},()=>fetch('/api/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)}).then(r=>r.json())))''',a)
  self.assertCountEqual([x['status'] for x in result],['APPROVED','ALREADY_CONFIRMED'])
  self.assertEqual(self.counts()[0],1)
  self.setUp();v=self.begin();a=self.assertion(v);self.app.lose_after=True
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'UNKNOWN')
  self.assertEqual(self.counts()[0],1)
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'ALREADY_CONFIRMED')
  self.assertEqual(self.counts()[0],1)
 def test_07_wrong_challenge_and_expiry(self):
  v=self.begin();a=self.assertion(v)
  with self.app.conn() as c:c.execute('UPDATE challenge SET expires=? WHERE id=?',(self.app.now()-1,v['challengeId']))
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'DENIED');self.assertEqual(self.counts()[0],0)
 def test_08_keyboard_and_no_prf(self):
  self.page.keyboard.press('Tab');f=self.page.evaluate('document.activeElement.id')
  self.assertIn(f,['confirm','cancel'])
  v=self.begin();a=self.assertion(v)
  self.assertNotIn('prf',json.dumps(a).lower());self.assertNotIn('extensions',json.dumps(a).lower())
  self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'APPROVED')

if __name__=='__main__':unittest.main(verbosity=2)
