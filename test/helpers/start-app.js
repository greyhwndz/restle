import Restle from '../../../dist/lib';
import schemas from '../fixtures/restle-schemas';

// FIXME: figure out local Mongo url
const restle = new Restle({
  port: 1337,
  database: 'mongodb://laddr:pook!00FF@ds047440.mongolab.com:47440/laddr-dev',
  namespace: '/api',
});

restle.register('person', schemas.person);
restle.register('animal', schemas.animal);
restle.register('bone', schemas.bone);

export default restle;