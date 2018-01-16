const superagent = require('superagent');

run().catch(error => console.error(error.stack));

async function run() {
  const post1 = superagent.post('http://localhost:3000/user', { email: 'val@test.com' });
  const post2 = superagent.post('http://localhost:3001/user', { email: 'val@test.com' });

  const responses = await Promise.all([
    post1.then(res => res.text).catch(error => error.response.text),
    post2.then(res => res.text).catch(error => error.response.text)
  ]);
  console.log(responses);
}
