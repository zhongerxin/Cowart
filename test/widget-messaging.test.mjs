import assert from 'node:assert/strict'
import test from 'node:test'

import { followUpSender, supportsMessageImages } from '../src/widgetMessaging.js'

test('follow-up sender uses the native Cowart host bridge when available', async () => {
  const messages = []
  const windowObject = {
    cowartMcp: {
      async sendFollowUpMessage(message) {
        messages.push(message)
        return { ok: true }
      }
    }
  }

  const sender = followUpSender(windowObject)
  assert.equal(typeof sender, 'function')
  assert.deepEqual(await sender({ prompt: 'Expand this selection.' }), { ok: true })
  assert.deepEqual(messages, [{ prompt: 'Expand this selection.' }])
})

test('follow-up sender stays unavailable in a standalone browser preview', () => {
  assert.equal(followUpSender({}), null)
})

test('message image support follows native host capabilities', () => {
  assert.equal(
    supportsMessageImages({
      cowartMcp: {
        getHostCapabilities: () => ({ message: { image: true } })
      }
    }),
    true
  )
  assert.equal(supportsMessageImages({}), false)
})
