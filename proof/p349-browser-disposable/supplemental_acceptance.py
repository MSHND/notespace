"""P349 proof-only supplemental checks; original prototype.py and acceptance.py remain unmodified.
Only diagnoses timing/focus test assertions, and checks a wrong credential. Not a production test.
"""
import json, unittest
from acceptance import BrowserAcceptance as Original

class Supplemental(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  Original.setUpClass()
 @classmethod
 def tearDownClass(cls):
  Original.tearDownClass()
 def setUp(self):
  Original.setUp()
 def receipts(self):
  with Original.app.conn() as c:
   return c.execute("SELECT count(*) FROM receipts").fetchone()[0]
 def test_01_cancel_settled_after_async_fetch(self):
  Original.page.get_by_role('button',name='Cancel').click()
  Original.page.get_by_role('status').get_by_text('Cancelled. Nothing was approved.').wait_for(timeout=8000)
  self.assertEqual(self.receipts(),0)
  print('P349_SUPPLEMENT_CANCEL=PASS; after awaited UI settlement, zero receipt',flush=True)
 def test_02_expiry_no_approval(self):
  with Original.app.conn() as c:
   c.execute("UPDATE intent SET expires=? WHERE id='ceremony-p349'",(Original.app.now()-1,))
  Original.page.get_by_role('button',name='Confirm with passkey').click()
  Original.page.get_by_role('status').get_by_text('Expired.',exact=False).wait_for(timeout=8000)
  self.assertEqual(self.receipts(),0)
  print('P349_SUPPLEMENT_EXPIRED=PASS; zero receipt',flush=True)
 def test_03_keyboard_actual_focus_sequence(self):
  Original.page.set_viewport_size({'width':360,'height':740})
  Original.page.goto(Original.base)
  self.assertLessEqual(Original.page.evaluate('document.documentElement.scrollWidth'),360)
  focus=[]
  for _ in range(7):
   Original.page.keyboard.press('Tab')
   focus.append(Original.page.evaluate('({tag:document.activeElement.tagName,id:document.activeElement.id,text:(document.activeElement.textContent||"").trim().slice(0,100)})'))
  ids=[x['id'] for x in focus]
  self.assertIn('confirm',ids)
  self.assertIn('cancel',ids)
  self.assertTrue(any(x['tag']=='SUMMARY' for x in focus))
  self.assertLess(ids.index('confirm'),ids.index('cancel'))
  Original.page.set_viewport_size({'width':1120,'height':850})
  print('P349_SUPPLEMENT_KEYBOARD=PASS; focus order includes details summary, confirm, cancel; width=360',flush=True)
 def test_04_wrong_credential_and_frozen_release(self):
  v=Original.api(Original.page,'/api/begin')
  self.assertEqual(v['status'],'READY')
  a=Original.assertion(v)
  with Original.app.conn() as c:
   bob=c.execute("SELECT id FROM credential WHERE account='acct-bob' LIMIT 1").fetchone()[0]
   before=c.execute("SELECT owner,resource,release,expected_rev,docs,manifest FROM intent").fetchone()
   frozen=tuple(before)
  forged=json.loads(json.dumps(a));forged['id']=bob;forged['rawId']=bob
  self.assertEqual(Original.api(Original.page,'/api/complete',forged)['status'],'DENIED')
  self.assertEqual(self.receipts(),0)
  with Original.app.conn() as c:
   self.assertEqual(tuple(c.execute("SELECT owner,resource,release,expected_rev,docs,manifest FROM intent").fetchone()),frozen)
  print('P349_SUPPLEMENT_WRONG_CREDENTIAL=PASS; frozen intent identical, zero receipt',flush=True)
 def test_90_close_and_abandon_no_approval(self):
  v=Original.api(Original.page,'/api/begin')
  self.assertEqual(v['status'],'READY')
  Original.page.close()
  Original.page=Original.ctx.new_page()
  Original.page.goto(Original.base)
  self.assertEqual(self.receipts(),0)
  print('P349_SUPPLEMENT_ABANDON=PASS; real browser page closed, zero receipt',flush=True)

if __name__=='__main__':
 unittest.main(verbosity=2)
