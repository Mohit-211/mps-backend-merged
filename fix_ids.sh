#!/bin/bash

for f in src/models/userToken.model.ts src/models/userAuth.model.ts; do
  if [ -f "$f" ]; then
    sed -i '' -E "s/import \{ Document, Schema, Model, model \} from 'mongoose';/import { Document, Schema, Model, model, Types } from 'mongoose';/" "$f"
    sed -i '' -E 's/^([[:space:]]*)_id: Schema\.Types\.ObjectId;/\1_id: Types.ObjectId;/' "$f"
    echo "fixed (named-import style): $f"
  fi
done

for f in $(grep -rl '_id: Schema\.Types\.ObjectId' src/models --include="*.model.ts"); do
  sed -i '' -E 's/^([[:space:]]*)_id: Schema\.Types\.ObjectId;/\1_id: mongoose.Types.ObjectId;/' "$f"
  echo "fixed (default-import style): $f"
done
