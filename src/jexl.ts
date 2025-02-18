import { DateTime } from 'luxon';
import jsonpath from 'jsonpath';
import mozjexl from 'jexl';

type Expression = string | SerialOperations;
type Operation = Record<string, Expression>;
type SerialOperations = Operation[];

interface ErrorObject {
  [key: string]: string;
}

type DateTimeFormatType = 'ISO' | 'RFC2822' | 'SQL' | 'HTTP' | 'Millis';

type PlainObject = Record<string, any>;

const isRegExpExpression = (expression: string) => {
  try {
    new RegExp(expression);
    return true;
  } catch (_error) {
    return false;
  }
};

const getType = (value: any) => {
  if (typeof value === 'string') {
    return 'String';
  } else if (typeof value === 'number') {
    return 'Number';
  } else if (typeof value === 'boolean') {
    return 'Boolean';
  } else if (typeof value === 'object' && Array.isArray(value)) {
    return 'Array';
  } else if (typeof value === 'object' && value !== null) {
    return 'Object';
  } else if (typeof value === 'undefined') {
    return 'undefined';
  } else if (value === null) {
    return 'null';
  }
};

const convertDateTime = (
  dateString: string,
  fromFormat: DateTimeFormatType,
  toFormat: DateTimeFormatType,
): string | ErrorObject => {
  let date: DateTime;

  // Parse the date string based on the "from" format
  switch (fromFormat) {
    case 'ISO':
      date = DateTime.fromISO(dateString, { setZone: true });
      break;
    case 'RFC2822':
      date = DateTime.fromRFC2822(dateString, { setZone: true });
      break;
    case 'SQL':
      date = DateTime.fromSQL(dateString, { setZone: true });
      break;
    case 'HTTP':
      date = DateTime.fromHTTP(dateString, { setZone: true });
      break;
    case 'Millis':
      date = DateTime.fromMillis(parseInt(dateString, 10));
      break;
    default:
      throw new Error(`Unsupported fromFormat "${fromFormat}"`);
  }

  // Check if the date is valid
  if (!date.isValid) {
    throw new Error(
      `Invalid date time string "${dateString}". Reason: ${date.invalidReason}`,
    );
  }

  // Convert the DateTime object to the desired "to" format
  switch (toFormat) {
    case 'ISO':
      return date.toISO() || 'Error: Failed to convert to ISO format';
    case 'RFC2822':
      return date.toRFC2822() || 'Error: Failed to convert to RFC2822 format';
    case 'SQL':
      return date.toSQL() || 'Error: Failed to convert to SQL format';
    case 'HTTP':
      return date.toHTTP() || 'Error: Failed to convert to HTTP format';
    case 'Millis':
      return date.toMillis().toString();
    default:
      throw new Error(`Error: Unsupported toFormat "${toFormat}"`);
  }
};

const isValidDateTime = (dateTimeString: unknown): dateTimeString is string => {
  if (dateTimeString != null || typeof dateTimeString !== 'string') {
    return false;
  }

  return DateTime.fromISO(dateTimeString, { setZone: true }).isValid;
};

const symmetricDifference = (
  setA: Set<string>,
  setB: Set<string>,
): Set<string> => {
  const difference = new Set(setA);
  for (const elem of setB) {
    if (difference.has(elem)) {
      difference.delete(elem);
    } else {
      difference.add(elem);
    }
  }
  return difference;
};

const isObject = (value: unknown): value is PlainObject => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const EQUALS_IGNORE_CASE = (left: unknown, right: unknown) => {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLocaleLowerCase();
  }
  throw new Error(
    `${getType(left)} _= ${getType(right)} is an invalid operation. "_=" only supports string types.`,
  );
};

const STRICT_EQUALS = (left: any, right: any) => {
  return left === right;
};

const UPPER = (val: unknown) => {
  if (typeof val === 'string') return val.toUpperCase();
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'upper'. <value> | upper is only supported for String`,
  );
};

const LOWER = (val: unknown) => {
  if (typeof val === 'string') return val.toLowerCase();
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'lower'. <value> | lower is only supported for String`,
  );
};

const CAPITALIZE = (val: unknown) => {
  if (typeof val === 'string') return val[0].toUpperCase() + val.slice(1);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'capitalize'. <value> | capitalize is only supported for String`,
  );
};

const SWAP_CASE = (val: unknown) => {
  if (typeof val === 'string') {
    return val
      .split('')
      .map(function (c) {
        return c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
      })
      .join('');
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'swapCase'. <value> | swapCase is only supported for String`,
  );
};

const STARTS_WITH = (val: unknown, char: string) => {
  if (typeof val === 'string') return val.startsWith(char);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'startsWith'. <value> | startsWith('<char>') is only supported for String`,
  );
};

const ENDS_WITH = (val: unknown, char: string) => {
  if (typeof val === 'string') return val.endsWith(char);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'endsWith'. <value> | endsWith('<char>') is only supported for String`,
  );
};

const INDEX_OF_CHAR = (val: unknown, char: string) => {
  if (typeof val === 'string') return val.indexOf(char);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'indexOfChar'. <value> | indexOfChar('<char>') is only supported for String`,
  );
};

const TRIM = (val: unknown) => {
  if (typeof val === 'string') return val.trim();
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'trim'. <value> | trim is only supported for String`,
  );
};

const LTRIM = (val: unknown) => {
  if (typeof val === 'string') return val.trimStart();
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'ltrim'. <value> | ltrim is only supported for String`,
  );
};

const RTRIM = (val: unknown) => {
  if (typeof val === 'string') return val.trimEnd();
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'rtrim'. <value> | rtrim is only supported for String`,
  );
};

const LENGTH = (val: unknown) => {
  if (typeof val === 'string') return val.length;
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'length'. <value> | length is only supported for String`,
  );
};

const REPLACE = (
  val: unknown,
  searchValue: string,
  replacementString: string,
) => {
  const searchParam: string | RegExp = isRegExpExpression(searchValue)
    ? new RegExp(searchValue)
    : searchValue;
  if (typeof val === 'string')
    return val.replace(searchParam, replacementString);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'replace'. <value> | replace(<search_string>,<replace_string>) is only supported for String`,
  );
};

const REPLACE_ALL = (
  val: unknown,
  searchValue: string,
  replacementString: string,
) => {
  const searchParam: string | RegExp = isRegExpExpression(searchValue)
    ? new RegExp(searchValue, 'g')
    : searchValue;
  if (typeof val === 'string')
    return val.replaceAll(searchParam, replacementString);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'replaceAll'. <value> | replaceAll(<search_string>,<replace_string>) is only supported for String`,
  );
};

const SPLIT = (val: unknown, delimiter: string) => {
  const delimiterParam: string | RegExp = isRegExpExpression(delimiter)
    ? new RegExp(delimiter)
    : delimiter;
  if (typeof val === 'string') return val.split(delimiterParam);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'split'. <value> | split(<delimiter>) is only supported for String`,
  );
};

const SUBSTRING = (val: unknown, startIndex: number, endIndex: number) => {
  if (typeof val === 'string') return val.substring(startIndex, endIndex);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'substring'. <value> | substring(<startIdx>,<endIdx>) is only supported for String`,
  );
};

const PAD_START = (val: unknown, stringLength: number, padWith: string) => {
  if (typeof val === 'string') return val.padStart(stringLength, padWith);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'padStart'. <value> | padStart(<stringLength>,<padWith>) is only supported for String`,
  );
};

const PAD_END = (val: unknown, stringLength: number, padWith: string) => {
  if (typeof val === 'string') return val.padEnd(stringLength, padWith);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'padEnd'. <value> | padEnd(<stringLength>,<padWith>) is only supported for String`,
  );
};

const PARSE_INT = (val: unknown, radix: number = 10) => {
  if (typeof val === 'string') return parseInt(val, radix);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'parseInt'. <value> | parseInt('<string>',<radix>) is only supported for String`,
  );
};

const PARSE_FLOAT = (val: unknown) => {
  if (typeof val === 'string') return parseFloat(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'parseFloat'. <value> | parseFloat is only supported for String`,
  );
};

const TO_BOOLEAN = (val: unknown) => {
  if (typeof val === 'string') return val === 'true';
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'toBoolean'. <value> | toBoolean is only supported for String`,
  );
};

const REVERSE = (val: unknown) => {
  if (typeof val === 'string') return val.split('').reverse().join('');
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'reverse'. <value> | reverse is only supported for String`,
  );
};

const SLUGIFY = (val: unknown) => {
  if (typeof val === 'string') return encodeURI(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'slugify'. <value> | slugify is only supported for String`,
  );
};

const UNSLUGIFY = (val: unknown) => {
  if (typeof val === 'string') return decodeURI(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'unslugify'. <value> | unslugify is only supported for String`,
  );
};

const GET = (val: Record<string, any>, property: string) => {
  if (typeof val === 'object' && !Array.isArray(val)) {
    return val?.[property] || null;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'get'. <value> | get(<property>) is only supported for Object`,
  );
};

const KEYS = (val: object) => {
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.keys(val);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'keys'. <value> | keys is only supported for Object`,
  );
};

const VALUES = (val: object) => {
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.values(val);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'values'. <value> | values is only supported for Object`,
  );
};

const ENTRIES = (val: object) => {
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.entries(val);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'entries'. <value> | entries is only supported for Object`,
  );
};

const HAS = (val: object, property: string) => {
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.hasOwn(val, property);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'has'. <value> | has is only supported for Object`,
  );
};

const DELETE = (val: Record<string, any>, properties: Array<string>) => {
  const result: Record<string, any> = {};
  if (typeof val === 'object' && !Array.isArray(val)) {
    const propertiesToKeep = symmetricDifference(
      new Set(Object.keys(val)),
      new Set(properties),
    );
    propertiesToKeep.forEach((property: string) => {
      result[property] = val[property];
    });
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'delete'. <value> | delete(<properties>) is only supported for Object`,
  );
};

const STRINGIFY = (val: object) => {
  if (typeof val === 'object' || Array.isArray(val)) {
    return JSON.stringify(val);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'stringify'. <value> | stringify is only supported for Object or Array`,
  );
};

const DEEP_MERGE = <T extends PlainObject, U extends PlainObject>(
  val: T,
  objectToMerge: U,
): T & U => {
  if (!isObject(val)) return objectToMerge as T & U;
  if (!isObject(objectToMerge)) return val as T & U;

  const merged: PlainObject = { ...val };

  for (const key in objectToMerge) {
    if (Object.prototype.hasOwnProperty.call(objectToMerge, key)) {
      const valProp = merged[key];
      const mergeProp = objectToMerge[key];

      if (isObject(valProp) && isObject(mergeProp)) {
        merged[key] = DEEP_MERGE(valProp, mergeProp);
      } else {
        merged[key] = mergeProp;
      }
    }
  }

  return merged as T & U;
};

const ABS = (val: unknown) => {
  if (typeof val === 'number') return Math.abs(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'abs'. <value> | abs is only supported for Number`,
  );
};

const CEIL = (val: unknown) => {
  if (typeof val === 'number') return Math.ceil(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'ceil'. <value> | ceil is only supported for Number`,
  );
};

const FLOOR = (val: unknown) => {
  if (typeof val === 'number') return Math.floor(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'floor'. <value> | floor is only supported for Number`,
  );
};

const ROUND = (val: unknown) => {
  if (typeof val === 'number') return Math.round(val);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'round'. <value> | round is only supported for Number`,
  );
};

const RANDOM = (_val: null) => {
  return Math.random();
};

const JSONPATH = (
  val: object | Array<any>,
  path: string | Record<string, any>[],
) => {
  if (
    typeof val === 'object' ||
    (typeof val === 'object' && Array.isArray(val))
  ) {
    const result: Record<string, any> = {};
    if (typeof path === 'string') return jsonpath.query(val, path);
    if (typeof path === 'object' && Array.isArray(path)) {
      path.forEach((record) => {
        Object.keys(record).forEach((field) => {
          const queryResult = jsonpath.query(val, record[field]);
          if (queryResult.length === 1) result[field] = queryResult[0];
          else if (queryResult.length === 0) result[field] = '';
          else result[field] = queryResult;
        });
      });
    }
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'jsonpath'. <value> | jsonpath(path|pathMap) is only supported for Object or Array`,
  );
};

const TYPE = (val: object) => {
  return getType(val);
};

const PARSE_JSON = (val: unknown) => {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch (error) {
      throw new Error(`The ${val} cannot be parsed : ${error}`);
    }
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'parseJson'. <value> | parseJson is only supported for String`,
  );
};

const UUID = (_val: null = null) => {
  return crypto.randomUUID();
};

const FORMAT_DATE_TIME = (val: unknown, format: string = 'yyyy-MM-dd') => {
  if (val instanceof DateTime) {
    return val.toFormat(format);
  }

  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');

  const r = DateTime.fromISO(val, { setZone: true }).toFormat(format);
  console.dir({ input: val, format, r }, { depth: null });

  return r;
};

const CONVERT_DATE_TIME_FORMAT = (
  val: unknown,
  fromFormat: DateTimeFormatType,
  toFormat: DateTimeFormatType,
) => {
  if (typeof val === 'string')
    return convertDateTime(val, fromFormat, toFormat);
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'convertDateTimeFormat'. <value> | convertDateTimeFormat(<fromFormat>,<toFormat>) is only supported for String`,
  );
};

const NOW_FN = () => {
  return (
    DateTime.now() ||
    (() => {
      throw new Error('Error fetching current local date time');
    })()
  );
};

const UTC_NOW_FN = () => {
    return (
    DateTime.now().toUTC() ||
    (() => {
      throw new Error('Error fetching current UTC date time');
    })()
  );
};

const NOW = (_val: unknown) => {
  return (
    DateTime.now() ||
    (() => {
      throw new Error('Error fetching current local date time');
    })()
  );
};

const UTC_NOW = (_val: unknown) => {
  return (
    DateTime.now().toUTC() ||
    (() => {
      throw new Error('Error fetching current UTC date time');
    })()
  );
};

const TO_UTC = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return (
    DateTime.fromISO(val, { setZone: true }).toUTC().toISO() ||
    (() => {
      throw new Error('Error while converting date time to UTC');
    })()
  );
};

const TO_LOCAL = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return (
    DateTime.fromISO(val, { setZone: true }).toLocal().toISO() ||
    (() => {
      throw new Error('Error while converting date time to local');
    })()
  );
};

const TO_MILLIS = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).toMillis().toString();
};

const GET_TIME_ZONE = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).zoneName;
};

const GET_SECONDS = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).second;
};

const GET_MINUTES = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).minute;
};

const GET_HOURS = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).hour;
};

const GET_DAY = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).day;
};

const GET_MONTH = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).month;
};

const GET_YEAR = (val: unknown) => {
  if (!isValidDateTime(val))
    throw new Error('Invalid date time string provided');
  return DateTime.fromISO(val, { setZone: true }).year;
};

const SET_TIME_ZONE = (val: unknown, timeZone: string) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).setZone(
    timeZone,
  );
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_SECONDS = (val: unknown, seconds: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    second: seconds,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_MINUTES = (val: unknown, minutes: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    minute: minutes,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_HOURS = (val: unknown, hours: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    hour: hours,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_DAY = (val: unknown, day: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    day: day,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_MONTH = (val: unknown, month: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    month: month,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const SET_YEAR = (val: unknown, year: number) => {
  if (!isValidDateTime(val)) {
    throw new Error('Invalid date time string provided');
  }
  const modifiedDateTime = DateTime.fromISO(val, { setZone: true }).set({
    year: year,
  });
  if (!isValidDateTime(modifiedDateTime.toString())) {
    throw new Error('Resulting date time is invalid');
  }
  return modifiedDateTime.toString();
};

const PLUCK = (val: Array<any>, properties: Array<String>) => {
  const result = [];
  const justOneProperty: boolean = properties.length === 1;
  for (let idx = 0; idx < val.length; idx++) {
    const objectAtIdx: Record<string, any> = {};
    properties.forEach((property: any) => {
      objectAtIdx[property] = val[idx][property];
    });
    result.push(justOneProperty ? Object.values(objectAtIdx)[0] : objectAtIdx);
  }
  return result;
};

const SIZE = (val: Array<any> | object | string) => {
  if (typeof val === 'string') return val.length;
  if (typeof val === 'object') {
    if (Array.isArray(val)) return val.length;
    return Object.keys(val).length;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'size'. <value> | size is only supported for Object, String, Array<any>`,
  );
};

const PUSH = (val: Array<any>, item: any) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    result.push(...item);
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'push'. <value> | push(<item>) is only supported for Array<any>`,
  );
};

const POP = (val: Array<any>) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    result.pop();
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'pop'. <value> | pop is only supported for Array<any>`,
  );
};

const JOIN = (val: Array<any>, delimiter: any) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    return result.join(delimiter);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'join'. <value> | join(<delimiter>) is only supported for Array<any>`,
  );
};

const SLICE = (val: Array<any>, startIdx: number, endIdx: number) => {
  if (typeof val === 'object' && Array.isArray(val)) {
    return val.slice(startIdx, endIdx);
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'slice'. <value> | slice(<startIdx>,<endIdx>) is only supported for Array<any>`,
  );
};

const REVERSE_ARRAY = (val: Array<any>) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    return result.reverse();
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'reverseArray'. <value> | reverseArray is only supported for Array<any>`,
  );
};

const SORT_ARRAY = (val: Array<any>) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    return result.sort();
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'sortArray'. <value> | sortArray is only supported for Array<any>`,
  );
};

// Code below is taken from here : https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/from#sequence_generator_range
const RANGE = (
  _val: null = null,
  start: number,
  stop: number,
  step: number,
) => {
  return Array.from(
    { length: (stop - start) / step + 1 },
    (_, i) => start + i * step,
  );
};

const RANGE_RIGHT = (
  _val: null = null,
  start: number,
  stop: number,
  step: number,
) => {
  return Array.from(
    { length: (start - stop) / step + 1 },
    (_, i) => start - i * Math.abs(step),
  );
};

const REMOVE_DUPLICATES = (val: Array<any>) => {
  const result: Array<any | ErrorObject> = structuredClone(val);
  if (typeof val === 'object' && Array.isArray(val)) {
    return [...new Set(result)];
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'removeDuplicates'. <value> | removeDuplicates is only supported for Array<any>`,
  );
};

const MAX = (val: Array<unknown>) => {
  let result: number = -Infinity;
  if (typeof val === 'object' && Array.isArray(val)) {
    val.forEach((record) => {
      if (typeof record === 'number') {
        result = record > result ? record : result;
      }
    });
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'max'. <value> | max is only supported for Array<Number>`,
  );
};

const MIN = (val: Array<unknown>) => {
  let result: number = Infinity;
  if (typeof val === 'object' && Array.isArray(val)) {
    val.forEach((record) => {
      if (typeof record === 'number') {
        result = record < result ? record : result;
      }
    });
    return result;
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'min'. <value> | min is only supported for Array<Number>`,
  );
};

// Operators
mozjexl.addBinaryOp('_=', 20, EQUALS_IGNORE_CASE);
mozjexl.addBinaryOp('===', 20, STRICT_EQUALS);

// String transforms
mozjexl.addTransform('upper', UPPER);
mozjexl.addTransform('lower', LOWER);
mozjexl.addTransform('capitalize', CAPITALIZE);
mozjexl.addTransform('swapCase', SWAP_CASE);
mozjexl.addTransform('startsWith', STARTS_WITH);
mozjexl.addTransform('endsWith', ENDS_WITH);
mozjexl.addTransform('indexOfChar', INDEX_OF_CHAR);
mozjexl.addTransform('trim', TRIM);
mozjexl.addTransform('ltrim', LTRIM);
mozjexl.addTransform('rtrim', RTRIM);
mozjexl.addTransform('length', LENGTH);
mozjexl.addTransform('replace', REPLACE);
mozjexl.addTransform('replaceAll', REPLACE_ALL);
mozjexl.addTransform('split', SPLIT);
mozjexl.addTransform('substring', SUBSTRING);
mozjexl.addTransform('padStart', PAD_START);
mozjexl.addTransform('padEnd', PAD_END);
mozjexl.addTransform('parseInt', PARSE_INT);
mozjexl.addTransform('parseFloat', PARSE_FLOAT);
mozjexl.addTransform('toBoolean', TO_BOOLEAN);
mozjexl.addTransform('reverse', REVERSE);
mozjexl.addTransform('slugify', SLUGIFY);
mozjexl.addTransform('unslugify', UNSLUGIFY);

// Misc transforms
mozjexl.addTransform('jsonpath', JSONPATH);
mozjexl.addTransform('type', TYPE);
mozjexl.addTransform('parseJson', PARSE_JSON);
mozjexl.addTransform('UUID', UUID);
mozjexl.addFunction('UUID', UUID);

// Array transforms
mozjexl.addTransform('pluck', PLUCK);
mozjexl.addTransform('size', SIZE);
mozjexl.addTransform('push', PUSH);
mozjexl.addTransform('pop', POP);
mozjexl.addTransform('join', JOIN);
mozjexl.addTransform('slice', SLICE);
mozjexl.addTransform('reverseArray', REVERSE_ARRAY);
mozjexl.addTransform('sortArray', SORT_ARRAY);
mozjexl.addTransform('range', RANGE);
mozjexl.addTransform('rangeRight', RANGE_RIGHT);
mozjexl.addTransform('removeDuplicates', REMOVE_DUPLICATES);
mozjexl.addTransform('max', MAX);
mozjexl.addTransform('min', MIN);

// Object transforms
mozjexl.addTransform('keys', KEYS);
mozjexl.addTransform('values', VALUES);
mozjexl.addTransform('entries', ENTRIES);
mozjexl.addTransform('get', GET);
mozjexl.addTransform('has', HAS);
mozjexl.addTransform('delete', DELETE);
mozjexl.addTransform('stringify', STRINGIFY);
mozjexl.addTransform('json', STRINGIFY);
mozjexl.addTransform('deepMerge', DEEP_MERGE);

// Number transforms
mozjexl.addTransform('abs', ABS);
mozjexl.addTransform('ceil', CEIL);
mozjexl.addTransform('floor', FLOOR);
mozjexl.addTransform('round', ROUND);
mozjexl.addTransform('random', RANDOM);
mozjexl.addFunction('random', RANDOM);

// Date transforms
mozjexl.addTransform('formatDateTime', FORMAT_DATE_TIME);
mozjexl.addTransform('convertDateTimeFormat', CONVERT_DATE_TIME_FORMAT);
mozjexl.addTransform('now', NOW);
mozjexl.addFunction('now', NOW_FN);
mozjexl.addTransform('utcNow', UTC_NOW);
mozjexl.addFunction('utcNow', UTC_NOW_FN);
mozjexl.addTransform('toUTC', TO_UTC);
mozjexl.addTransform('toLocal', TO_LOCAL);
mozjexl.addTransform('toMillis', TO_MILLIS);
mozjexl.addTransform('getSeconds', GET_SECONDS);
mozjexl.addTransform('getTimeZone', GET_TIME_ZONE);
mozjexl.addTransform('getMinutes', GET_MINUTES);
mozjexl.addTransform('getHours', GET_HOURS);
mozjexl.addTransform('getDay', GET_DAY);
mozjexl.addTransform('getMonth', GET_MONTH);
mozjexl.addTransform('getYear', GET_YEAR);
mozjexl.addTransform('setSeconds', SET_SECONDS);
mozjexl.addTransform('setTimeZone', SET_TIME_ZONE);
mozjexl.addTransform('setMinutes', SET_MINUTES);
mozjexl.addTransform('setHours', SET_HOURS);
mozjexl.addTransform('setDay', SET_DAY);
mozjexl.addTransform('setMonth', SET_MONTH);
mozjexl.addTransform('setYear', SET_YEAR);

/**
 * This must be loaded into the `mozjexl` object last, which is why
 * it is placed here.
 *
 * Loading it last ensures that all dependencies or preceding configurations
 * are already in place, maintaining the correct order of operations.
 */
const EVALUATE_EXPRESSION = async (val: unknown, context: Record<any, any>) => {
  if (typeof val === 'string') {
    const regex = /{{\s*(.+?)\s*}}/g;
    const parts = val.split(regex);
    for (let i = 1; i < parts.length; i += 2) {
      const result = await mozjexl.eval(parts[i], context);
      if (typeof result !== 'string')
        parts[i] = JSON.stringify(await mozjexl.eval(parts[i], context));
      else parts[i] = await mozjexl.eval(parts[i], context);
    }
    return parts.join('');
  }
  throw new Error(
    `The ${val} of type ${getType(val)} has no method 'evaluateExpression'. <value> | evaluateExpression(context) is only supported for String`,
  );
};

mozjexl.addTransform('evaluateExpression', EVALUATE_EXPRESSION);

// noinspection JSUnusedGlobalSymbols
export default mozjexl;

export { mozjexl, mozjexl as jexl };
