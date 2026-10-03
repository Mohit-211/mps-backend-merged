/* oxlint-disable typescript/no-explicit-any */
type AnyObject = Record<string, any>;

const pick = (object: AnyObject | null | undefined, keys: string[]): AnyObject => {
  return keys.reduce((obj: AnyObject, key: string) => {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      obj[key] = object[key];
    }
    return obj;
  }, {});
};

export default pick;
