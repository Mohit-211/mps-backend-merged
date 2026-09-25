import mongoose from 'mongoose';

function compareObjectIds(id1, id2) {
  const objectId1 = new mongoose.Types.ObjectId(id1);
  const objectId2 = new mongoose.Types.ObjectId(id2);

  return objectId1.equals(objectId2);
}


export default compareObjectIds;