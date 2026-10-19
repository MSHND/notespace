"""P349 derived final browser acceptance; the original eight scenarios remain authoritative.

Only test_02 and test_08 override timing/focus assumptions in acceptance.py.
All other test methods, genuine Chromium WebAuthn and verifier checks are inherited.
No Pocket application code, real passkeys, PRF or encrypted data are used.
"""
import json
import unittest
from acceptance import BrowserAcceptance as Original


class CorrectedBrowserAcceptance(Original):
    def tearDown(self):
        count = self.counts()[0]
        self.assertLessEqual(count, 1, 'A disposable scenario created multiple approval receipts')
        print(f'P349_SCENARIO={self._testMethodName}; receipt_count={count}', flush=True)

    def test_02_cancel_abandon_expiry(self):
        self.page.get_by_role('button', name='Cancel').click()
        self.page.get_by_role('status').get_by_text(
            'Cancelled. Nothing was approved.', exact=True
        ).wait_for(timeout=8000)
        with self.app.conn() as c:
            self.assertEqual(c.execute(
                "SELECT status FROM intent WHERE id='ceremony-p349'"
            ).fetchone()['status'], 'CANCELLED')
        self.assertEqual(self.counts()[0], 0)
        print('P349_BROWSER_CANCEL_SETTLED=PASS; receipt_count=0', flush=True)

        # The remaining original abandonment and expiry scenarios are unchanged.
        self.setUp(); self.begin(); self.page.close(); self.page=self.ctx.new_page(); self.page.goto(self.base); self.assertEqual(self.counts()[0],0)
        self.cdp.detach(); self.cdp=self.ctx.new_cdp_session(self.page); self.cdp.send('WebAuthn.enable'); self.alice_auth=self.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'usb','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
        # Authenticator above lost its earlier credential; recreate synthetic account credential.
        self.register('alice'); self.setUp(); self.app.clock_offset=4000
        self.page.get_by_role('button',name='Confirm with passkey').click(); self.page.get_by_role('status').get_by_text('Expired',exact=True).wait_for(timeout=8000); self.assertEqual(self.counts()[0],0)

    def test_08_keyboard_and_no_prf(self):
        self.page.set_viewport_size({'width':360,'height':740})
        self.page.reload()
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 360)
        sequence = []
        for _ in range(7):
            self.page.keyboard.press('Tab')
            sequence.append(self.page.evaluate('''() => {
                const el = document.activeElement;
                const style = getComputedStyle(el);
                return {
                    tag: el.tagName,
                    id: el.id,
                    focusVisible: el.matches(':focus-visible'),
                    visible: !!el.getClientRects().length,
                    outlineStyle: style.outlineStyle,
                    outlineWidth: style.outlineWidth
                };
            }'''))
        order = ['summary' if s['tag']=='SUMMARY' else s['id'] for s in sequence]
        for target in ('summary','confirm','cancel'):
            self.assertIn(target, order, f'Missing keyboard target: {target}; sequence={order}')
        self.assertLess(order.index('summary'),order.index('confirm'))
        self.assertLess(order.index('confirm'),order.index('cancel'))
        for target in ('summary','confirm','cancel'):
            state=sequence[order.index(target)]
            self.assertTrue(state['visible'], f'{target} not visibly focusable')
            self.assertTrue(state['focusVisible'], f'{target} lacks :focus-visible')
            self.assertNotEqual(state['outlineStyle'],'none', f'{target} lacks a focus outline')
            self.assertNotEqual(state['outlineWidth'],'0px', f'{target} outline has no width')
        print('P349_BROWSER_KEYBOARD=PASS; order=summary>confirm>cancel; visible outlines; narrow_width=360',flush=True)

        # Preserve the original assertion and no-PRF checks exactly, then tighten receipt accounting.
        v=self.begin();a=self.assertion(v)
        self.assertNotIn('prf',json.dumps(a).lower());self.assertNotIn('extensions',json.dumps(a).lower())
        self.assertEqual(self.api(self.page,'/api/complete',a)['status'],'APPROVED')
        self.assertEqual(self.counts()[0],1)
        self.assertFrozen()


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(CorrectedBrowserAcceptance)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun==8 else 1)
