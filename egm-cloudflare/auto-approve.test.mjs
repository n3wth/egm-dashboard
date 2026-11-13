import test from 'node:test'
import assert from 'node:assert/strict'
import { autoApprovedEmail } from './auto-approve.mjs'

test('approves exact google.com addresses only', () => {
  assert.equal(autoApprovedEmail('person@google.com'), true)
  assert.equal(autoApprovedEmail('Person@Google.COM'), true)
  for (const email of ['person@mail.google.com', 'person@google.com.evil.test', 'person@notgoogle.com', 'a@b@google.com', '@google.com', 'google.com', '', null]) {
    assert.equal(autoApprovedEmail(email), false, String(email))
  }
})
