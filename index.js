const Archetype = require('archetype');
const { MongoClient, ObjectId } = require('mongodb');
const StandardError = require('standard-error');
const bodyParser = require('body-parser');
const express = require('express');
const morgan = require('morgan'); // express logger

run().catch(error => console.error(error.stack));

async function run() {
  const client = await MongoClient.connect('mongodb://localhost:27017/test');
  const db = client.db('test');

  await db.collection('Lock').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const app = express();

  app.use(bodyParser.json());
  app.use(morgan('tiny'));

  const UserType = new Archetype({
    email: {
      $type: 'string',
      $required: true
    }
  }).compile('UserType');

  app.post('/user', wrap(async function register(req) {
    const user = new UserType(req.body);
    user.email = user.email.toLowerCase();

    // Get a lock on the user's email. This is atomic on the MongoDB side, so
    // safe even if there are multiple instances of this API running
    const lock = await acquire(`user:email:${user.email}`);

    // Search for existing user unless email ends with given string
    if (!user.email.endsWith('@mycompany.com')) {
      console.log(new Date(), `Checking ${user.email}`);
      const existingUser = await db.collection('User').findOne({ email: user.email });
      console.log(new Date(), `Checked ${user.email}`);
      if (existingUser != null) { 
        // Make sure to release the lock before ending this function
        await release(lock); 
        throw new StandardError(`User already exists with email ${user.email}`, { status: 400 });
      }
    }
    console.log(new Date(), `Inserting ${user.email}`);
    await db.collection('User').insertOne(user);
    console.log(new Date(), `Inserted ${user.email}`);
    // Release the lock now that the critical section is done
    await release(lock);
    return { user };
  }));

  // Take the `UserType` and add an `_id` to it
  const UserUpdateType = UserType.
    path('_id', { $type: ObjectId, $required: true }).
    compile('UserUpdateType');

  app.put('/user', wrap(async function register(req) {
    const user = new UserUpdateType(req.body);
    user.email = user.email.toLowerCase();

    const lock = await acquire(`user:email:${user.email}`);

    // Search for existing user unless email ends with given string
    if (!user.email.endsWith('@mycompany.com')) {
      console.log(new Date(), `Checking ${user.email}`);
      const existingUser = await db.collection('User').findOne({ email: user.email });
      console.log(new Date(), `Checked ${user.email}`);
      if (existingUser != null) { 
        // Make sure to release the lock before ending this function
        await release(lock); 
        throw new StandardError(`User already exists with email ${user.email}`, { status: 400 });
      }
    }
    console.log(new Date(), `Inserting ${user.email}`);
    await db.collection('User').updateOne({ _id: user._id }, { $set: user });
    console.log(new Date(), `Inserted ${user.email}`);
    // Release the lock now that the critical section is done
    await release(lock);
    return { user };
  }));

  app.listen(process.env.PORT || 3000);

  // Helper to acquire a lock
  async function acquire(resourceId) {
    // In order to defend against deadlocks, give up after a certain number of tries
    const NUM_RETRIES = 3;

    for (let i = 0; i < NUM_RETRIES; ++i) {
      // 1. Try to acquire the lock
      const res = await _acquire(resourceId);

      // 2. If you successfully acquired the lock, return the lock document
      if (!res.lastErrorObject.updatedExisting) {
        return res.value;
      }
      
      // 3. If not, `waitUntil()` the existing lock's `expiresAt`
      const existingLock = res.value;
      await waitUntil(existingLock.expiresAt);
    }
    
    // 4. Repeat 1-3 until you've run out of retries
    throw new StandardError('Conflict!', { status: 409 });
  }

  // Helper to try to acquire the lock
  async function _acquire(resourceId) {
    const query = { _id: resourceId };
    // Make the lock expire in case we forget to release it
    const update = {
      $setOnInsert: { expiresAt: new Date(Date.now() + 1000) }
    };
    const res = await db.collection('Lock').findOneAndUpdate(query, update, {
      upsert: true,
      returnOriginal: false
    });

    return res;
  }

  // Helper to release a lock
  async function release(lock) {
    await db.collection('Lock').deleteOne({ _id: lock._id });
  }
}

async function waitUntil(time) {
  // Given a Date `time`, wait until `time`
  await new Promise(resolve => setTimeout(() => resolve(), time.valueOf() - Date.now()));
}

// Convenience helper for async/await with Express
function wrap(fn) {
  return function(req, res, next) {
    fn(req).
      then(returnVal => res.json(returnVal)).
      catch(err => res.status(err.status || 500).json({ message: err.message }));
  };
}
