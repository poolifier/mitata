let _logger;
try {
  _logger = console.log;
} catch {
  _logger = print;
}

if ('function' !== typeof _logger)
  throw new TypeError('logger is not a function');

export const logger = _logger;
