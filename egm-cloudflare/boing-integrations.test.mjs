import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {publicWebsiteUrl,createRepositoryToken,collectGitHubProject,collectWebsitePerformance} from './boing-integrations.mjs'

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
const project={installationId:123,repositoryId:456,owner:'example',repository:'project',appId:'1234',privateKey}

test('website validation rejects credentials, IP addresses, local names, ports and non-web protocols',()=>{
  for(const url of ['http://localhost','http://127.0.0.1','http://[::1]','http://10.1.2.3','http://example.local','http://service.internal','https://user:password@public.com','https://public.com:8443','file:///etc/passwd','http://2130706433']) {
    assert.throws(()=>publicWebsiteUrl(url))
  }
  assert.equal(publicWebsiteUrl('https://public.com/page#fragment'),'https://public.com/page')
})

test('query strings are rejected, including existing URLs, before contacting PageSpeed',async()=>{
  for(const url of ['https://public.com/?token=secret', 'https://public.com/path?', 'https://public.com/path?x=1#section']) {
    assert.throws(()=>publicWebsiteUrl(url),/query string/)
    let called=false
    await assert.rejects(collectWebsitePerformance(url,'key',async()=>{called=true}),/query string/)
    assert.equal(called,false)
  }
  assert.equal(publicWebsiteUrl('https://public.com/path%3Fpart#section'),'https://public.com/path%3Fpart')
})

test('GitHub installation tokens are restricted to the selected repository and read-only permissions',async()=>{
  let seen
  const result=await createRepositoryToken(project,async(url,options)=>{
    seen={url,options,body:JSON.parse(options.body)}
    return Response.json({token:'installation-secret',expires_at:'2099-01-01T00:00:00Z'})
  })
  assert.equal(seen.url,'https://api.github.com/app/installations/123/access_tokens')
  assert.deepEqual(seen.body.repository_ids,[456])
  assert.deepEqual(seen.body.permissions,{metadata:'read'})
  assert.equal(seen.options.redirect,'manual')
  assert.equal(result.token,'installation-secret')
})

test('installation token requests reject provider redirects',async()=>{
  let calls=0
  await assert.rejects(createRepositoryToken(project,async(_url,options)=>{
    calls++
    assert.equal(options.redirect,'manual')
    return new Response(null,{status:302,headers:{location:'https://evil.test/'}})
  }),/Provider request failed/)
  assert.equal(calls,1)
})

test('repository identity is verified before optional traffic collection',async()=>{
  let calls=0
  await assert.rejects(collectGitHubProject(project,async(url)=>{
    calls++
    if(url.endsWith('/access_tokens')) return Response.json({token:'secret',expires_at:'2099-01-01'})
    return Response.json({id:999})
  }),/does not match/)
  assert.equal(calls,2)
})

test('unavailable private traffic remains unknown and is not silently zero',async()=>{
  const result=await collectGitHubProject({...project,includeTraffic:true},async(url,options)=>{
    if(url.endsWith('/access_tokens')) { assert.deepEqual(JSON.parse(options.body).permissions,{metadata:'read',administration:'read'}); return Response.json({token:'secret',expires_at:'2099-01-01'}) }
    if(url.endsWith('/repos/example/project')) return Response.json({id:456,full_name:'example/project',private:true,stargazers_count:4,forks_count:1,open_issues_count:2})
    if(url.endsWith('/traffic/views')) return new Response('',{status:403})
    if(url.endsWith('/traffic/clones')) return Response.json({count:3,uniques:2})
    throw new Error('unexpected fetch')
  })
  assert.equal(result.metrics.stars,4)
  assert.deepEqual(result.traffic.views,{count:null,uniques:null,status:'unavailable'})
  assert.deepEqual(result.traffic.clones,{count:3,uniques:2,status:'available'})
  assert.equal(JSON.stringify(result).includes('secret'),false)
})

test('traffic is unavailable without requesting administration access',async()=>{
  let calls=0
  const result=await collectGitHubProject(project,async(url)=>{
    calls++
    if(url.endsWith('/access_tokens')) return Response.json({token:'secret',expires_at:'2099-01-01'})
    if(url.endsWith('/repos/example/project')) return Response.json({id:456,full_name:'example/project',private:true})
    throw new Error('unexpected fetch')
  })
  assert.equal(calls,2)
  assert.equal(result.traffic.views.status,'unavailable')
  assert.equal(result.traffic.clones.status,'unavailable')
})

test('PageSpeed uses only fixed Google endpoint and does not leak failed URLs or API keys',async()=>{
  let calls=0
  const missing=await collectWebsitePerformance('https://project.com','',async()=>{calls++;throw Error('unexpected')})
  assert.equal(missing.reason,'not_configured'); assert.equal(calls,0)
  const result=await collectWebsitePerformance('https://project.com','secret-key',async(url,options)=>{
    calls++
    assert.equal(new URL(url).origin,'https://www.googleapis.com')
    assert.equal(options.redirect,'manual')
    return new Response('',{status:503})
  })
  assert.equal(result.reason,'provider_error'); assert.equal(JSON.stringify(result).includes('secret-key'),false)
  const success=await collectWebsitePerformance('https://project.com','key',async()=>Response.json({lighthouseResult:{categories:{performance:{score:0.83}}}}))
  assert.equal(success.performanceScore,83)
})
