const mongodb = require('mongodb');
const superagent = require('superagent');

run().catch(error => console.error(error.stack));

async function run() {
  const register = superagent.post('http://localhost:3000/user', { email: 'val@test.com' });
  const update = superagent.put('http://localhost:3001/user', { _id: new mongodb.ObjectId(), email: 'val@test.com' });

  const responses = await Promise.all([
    register.then(res => res.text).catch(error => error.response.text),
    update.then(res => res.text).catch(error => error.response.text)
  ]);
  console.log(responses);
}
