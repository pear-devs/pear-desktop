/*
* SoundTouch Audio Worklet v0.2.1 AudioWorklet using the
* SoundTouch audio processing library
*
* Copyright (c) Olli Parviainen
* Copyright (c) Ryan Berdeen
* Copyright (c) Jakub Fiala
* Copyright (c) Steve 'Cutter' Blades
*
* This library is free software; you can redistribute it and/or
* modify it under the terms of the GNU Lesser General Public
* License as published by the Free Software Foundation; either
* version 2.1 of the License, or (at your option) any later version.
*
* This library is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
* Lesser General Public License for more details.
*
* You should have received a copy of the GNU Lesser General Public
* License along with this library; if not, write to the Free Software
* Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
*/

'use strict';

function _assertThisInitialized(e) {
  if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  return e;
}
function _callSuper(t, o, e) {
  return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
}
function _classCallCheck(a, n) {
  if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
}
function _construct(t, e, r) {
  if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments);
  var o = [null];
  o.push.apply(o, e);
  var p = new (t.bind.apply(t, o))();
  return r && _setPrototypeOf(p, r.prototype), p;
}
function _defineProperties(e, r) {
  for (var t = 0; t < r.length; t++) {
    var o = r[t];
    o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
  }
}
function _createClass(e, r, t) {
  return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", {
    writable: false
  }), e;
}
function _get() {
  return _get = "undefined" != typeof Reflect && Reflect.get ? Reflect.get.bind() : function (e, t, r) {
    var p = _superPropBase(e, t);
    if (p) {
      var n = Object.getOwnPropertyDescriptor(p, t);
      return n.get ? n.get.call(arguments.length < 3 ? e : r) : n.value;
    }
  }, _get.apply(null, arguments);
}
function _getPrototypeOf(t) {
  return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {
    return t.__proto__ || Object.getPrototypeOf(t);
  }, _getPrototypeOf(t);
}
function _inherits(t, e) {
  if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
  t.prototype = Object.create(e && e.prototype, {
    constructor: {
      value: t,
      writable: true,
      configurable: true
    }
  }), Object.defineProperty(t, "prototype", {
    writable: false
  }), e && _setPrototypeOf(t, e);
}
function _isNativeFunction(t) {
  try {
    return -1 !== Function.toString.call(t).indexOf("[native code]");
  } catch (n) {
    return "function" == typeof t;
  }
}
function _isNativeReflectConstruct() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));
  } catch (t) {}
  return (_isNativeReflectConstruct = function () {
    return !!t;
  })();
}
function _possibleConstructorReturn(t, e) {
  if (e && ("object" == typeof e || "function" == typeof e)) return e;
  if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
  return _assertThisInitialized(t);
}
function _setPrototypeOf(t, e) {
  return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {
    return t.__proto__ = e, t;
  }, _setPrototypeOf(t, e);
}
function _superPropBase(t, o) {
  for (; !{}.hasOwnProperty.call(t, o) && null !== (t = _getPrototypeOf(t)););
  return t;
}
function _superPropGet(t, o, e, r) {
  var p = _get(_getPrototypeOf(t.prototype ), o, e);
  return "function" == typeof p ? function (t) {
    return p.apply(e, t);
  } : p;
}
function _toPrimitive(t, r) {
  if ("object" != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r);
    if ("object" != typeof i) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (String )(t);
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, "string");
  return "symbol" == typeof i ? i : i + "";
}
function _wrapNativeSuper(t) {
  var r = "function" == typeof Map ? new Map() : void 0;
  return _wrapNativeSuper = function (t) {
    if (null === t || !_isNativeFunction(t)) return t;
    if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function");
    if (void 0 !== r) {
      if (r.has(t)) return r.get(t);
      r.set(t, Wrapper);
    }
    function Wrapper() {
      return _construct(t, arguments, _getPrototypeOf(this).constructor);
    }
    return Wrapper.prototype = Object.create(t.prototype, {
      constructor: {
        value: Wrapper,
        enumerable: false,
        writable: true,
        configurable: true
      }
    }), _setPrototypeOf(Wrapper, t);
  }, _wrapNativeSuper(t);
}

var FifoSampleBuffer = function () {
  function FifoSampleBuffer() {
    _classCallCheck(this, FifoSampleBuffer);
    this._vector = new Float32Array();
    this._position = 0;
    this._frameCount = 0;
  }
  return _createClass(FifoSampleBuffer, [{
    key: "vector",
    get: function get() {
      return this._vector;
    }
  }, {
    key: "position",
    get: function get() {
      return this._position;
    }
  }, {
    key: "startIndex",
    get: function get() {
      return this._position * 2;
    }
  }, {
    key: "frameCount",
    get: function get() {
      return this._frameCount;
    }
  }, {
    key: "endIndex",
    get: function get() {
      return (this._position + this._frameCount) * 2;
    }
  }, {
    key: "clear",
    value: function clear() {
      this.receive(this._frameCount);
      this.rewind();
    }
  }, {
    key: "put",
    value: function put(numFrames) {
      this._frameCount += numFrames;
    }
  }, {
    key: "putSamples",
    value: function putSamples(samples, position) {
      var numFrames = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
      position = position || 0;
      var sourceOffset = position * 2;
      if (!(numFrames >= 0)) {
        numFrames = (samples.length - sourceOffset) / 2;
      }
      var numSamples = numFrames * 2;
      this.ensureCapacity(numFrames + this._frameCount);
      var destOffset = this.endIndex;
      this.vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
      this._frameCount += numFrames;
    }
  }, {
    key: "putBuffer",
    value: function putBuffer(buffer, position) {
      var numFrames = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
      position = position || 0;
      if (!(numFrames >= 0)) {
        numFrames = buffer.frameCount - position;
      }
      this.putSamples(buffer.vector, buffer.position + position, numFrames);
    }
  }, {
    key: "receive",
    value: function receive(numFrames) {
      if (!(numFrames >= 0) || numFrames > this._frameCount) {
        numFrames = this.frameCount;
      }
      this._frameCount -= numFrames;
      this._position += numFrames;
    }
  }, {
    key: "receiveSamples",
    value: function receiveSamples(output) {
      var numFrames = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      var numSamples = numFrames * 2;
      var sourceOffset = this.startIndex;
      output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
      this.receive(numFrames);
    }
  }, {
    key: "extract",
    value: function extract(output) {
      var position = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      var numFrames = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
      var sourceOffset = this.startIndex + position * 2;
      var numSamples = numFrames * 2;
      output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    }
  }, {
    key: "ensureCapacity",
    value: function ensureCapacity() {
      var numFrames = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      var minLength = parseInt(numFrames * 2);
      if (this._vector.length < minLength) {
        var newVector = new Float32Array(minLength);
        newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
        this._vector = newVector;
        this._position = 0;
      } else {
        this.rewind();
      }
    }
  }, {
    key: "ensureAdditionalCapacity",
    value: function ensureAdditionalCapacity() {
      var numFrames = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      this.ensureCapacity(this._frameCount + numFrames);
    }
  }, {
    key: "rewind",
    value: function rewind() {
      if (this._position > 0) {
        this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
        this._position = 0;
      }
    }
  }]);
}();
var AbstractFifoSamplePipe = function () {
  function AbstractFifoSamplePipe(createBuffers) {
    _classCallCheck(this, AbstractFifoSamplePipe);
    if (createBuffers) {
      this._inputBuffer = new FifoSampleBuffer();
      this._outputBuffer = new FifoSampleBuffer();
    } else {
      this._inputBuffer = this._outputBuffer = null;
    }
  }
  return _createClass(AbstractFifoSamplePipe, [{
    key: "inputBuffer",
    get: function get() {
      return this._inputBuffer;
    },
    set: function set(inputBuffer) {
      this._inputBuffer = inputBuffer;
    }
  }, {
    key: "outputBuffer",
    get: function get() {
      return this._outputBuffer;
    },
    set: function set(outputBuffer) {
      this._outputBuffer = outputBuffer;
    }
  }, {
    key: "clear",
    value: function clear() {
      this._inputBuffer.clear();
      this._outputBuffer.clear();
    }
  }]);
}();
var RateTransposer = function (_AbstractFifoSamplePi) {
  function RateTransposer(createBuffers) {
    var _this;
    _classCallCheck(this, RateTransposer);
    _this = _callSuper(this, RateTransposer, [createBuffers]);
    _this.reset();
    _this._rate = 1;
    return _this;
  }
  _inherits(RateTransposer, _AbstractFifoSamplePi);
  return _createClass(RateTransposer, [{
    key: "rate",
    set: function set(rate) {
      this._rate = rate;
    }
  }, {
    key: "reset",
    value: function reset() {
      this.slopeCount = 0;
      this.prevSampleL = 0;
      this.prevSampleR = 0;
    }
  }, {
    key: "clone",
    value: function clone() {
      var result = new RateTransposer();
      result.rate = this._rate;
      return result;
    }
  }, {
    key: "process",
    value: function process() {
      var numFrames = this._inputBuffer.frameCount;
      this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
      var numFramesOutput = this.transpose(numFrames);
      this._inputBuffer.receive();
      this._outputBuffer.put(numFramesOutput);
    }
  }, {
    key: "transpose",
    value: function transpose() {
      var numFrames = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      if (numFrames === 0) {
        return 0;
      }
      var src = this._inputBuffer.vector;
      var srcOffset = this._inputBuffer.startIndex;
      var dest = this._outputBuffer.vector;
      var destOffset = this._outputBuffer.endIndex;
      var used = 0;
      var i = 0;
      while (this.slopeCount < 1.0) {
        dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
        dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];
        i = i + 1;
        this.slopeCount += this._rate;
      }
      this.slopeCount -= 1.0;
      if (numFrames !== 1) {
        out: while (true) {
          while (this.slopeCount > 1.0) {
            this.slopeCount -= 1.0;
            used = used + 1;
            if (used >= numFrames - 1) {
              break out;
            }
          }
          var srcIndex = srcOffset + 2 * used;
          dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
          dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];
          i = i + 1;
          this.slopeCount += this._rate;
        }
      }
      this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
      this.prevSampleR = src[srcOffset + 2 * numFrames - 1];
      return i;
    }
  }]);
}(AbstractFifoSamplePipe);
var FilterSupport = function () {
  function FilterSupport(pipe) {
    _classCallCheck(this, FilterSupport);
    this._pipe = pipe;
  }
  return _createClass(FilterSupport, [{
    key: "pipe",
    get: function get() {
      return this._pipe;
    }
  }, {
    key: "inputBuffer",
    get: function get() {
      return this._pipe.inputBuffer;
    }
  }, {
    key: "outputBuffer",
    get: function get() {
      return this._pipe.outputBuffer;
    }
  }, {
    key: "fillInputBuffer",
    value: function fillInputBuffer() {
      throw new Error('fillInputBuffer() not overridden');
    }
  }, {
    key: "fillOutputBuffer",
    value: function fillOutputBuffer() {
      var numFrames = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      while (this.outputBuffer.frameCount < numFrames) {
        var numInputFrames = 8192 * 2 - this.inputBuffer.frameCount;
        this.fillInputBuffer(numInputFrames);
        if (this.inputBuffer.frameCount < 8192 * 2) {
          break;
        }
        this._pipe.process();
      }
    }
  }, {
    key: "clear",
    value: function clear() {
      this._pipe.clear();
    }
  }]);
}();
var noop = function noop() {
  return;
};
var SimpleFilter = function (_FilterSupport) {
  function SimpleFilter(sourceSound, pipe) {
    var _this2;
    var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : noop;
    _classCallCheck(this, SimpleFilter);
    _this2 = _callSuper(this, SimpleFilter, [pipe]);
    _this2.callback = callback;
    _this2.sourceSound = sourceSound;
    _this2.historyBufferSize = 22050;
    _this2._sourcePosition = 0;
    _this2.outputBufferPosition = 0;
    _this2._position = 0;
    return _this2;
  }
  _inherits(SimpleFilter, _FilterSupport);
  return _createClass(SimpleFilter, [{
    key: "position",
    get: function get() {
      return this._position;
    },
    set: function set(position) {
      if (position > this._position) {
        throw new RangeError('New position may not be greater than current position');
      }
      var newOutputBufferPosition = this.outputBufferPosition - (this._position - position);
      if (newOutputBufferPosition < 0) {
        throw new RangeError('New position falls outside of history buffer');
      }
      this.outputBufferPosition = newOutputBufferPosition;
      this._position = position;
    }
  }, {
    key: "sourcePosition",
    get: function get() {
      return this._sourcePosition;
    },
    set: function set(sourcePosition) {
      this.clear();
      this._sourcePosition = sourcePosition;
    }
  }, {
    key: "onEnd",
    value: function onEnd() {
      this.callback();
    }
  }, {
    key: "fillInputBuffer",
    value: function fillInputBuffer() {
      var numFrames = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      var samples = new Float32Array(numFrames * 2);
      var numFramesExtracted = this.sourceSound.extract(samples, numFrames, this._sourcePosition);
      this._sourcePosition += numFramesExtracted;
      this.inputBuffer.putSamples(samples, 0, numFramesExtracted);
    }
  }, {
    key: "extract",
    value: function extract(target) {
      var numFrames = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      this.fillOutputBuffer(this.outputBufferPosition + numFrames);
      var numFramesExtracted = Math.min(numFrames, this.outputBuffer.frameCount - this.outputBufferPosition);
      this.outputBuffer.extract(target, this.outputBufferPosition, numFramesExtracted);
      var currentFrames = this.outputBufferPosition + numFramesExtracted;
      this.outputBufferPosition = Math.min(this.historyBufferSize, currentFrames);
      this.outputBuffer.receive(Math.max(currentFrames - this.historyBufferSize, 0));
      this._position += numFramesExtracted;
      return numFramesExtracted;
    }
  }, {
    key: "handleSampleData",
    value: function handleSampleData(event) {
      this.extract(event.data, 4096);
    }
  }, {
    key: "clear",
    value: function clear() {
      _superPropGet(SimpleFilter, "clear", this)([]);
      this.outputBufferPosition = 0;
    }
  }]);
}(FilterSupport);
var USE_AUTO_SEQUENCE_LEN = 0;
var DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
var USE_AUTO_SEEKWINDOW_LEN = 0;
var DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
var DEFAULT_OVERLAP_MS = 8;
var _SCAN_OFFSETS = [[124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0], [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
var AUTOSEQ_TEMPO_LOW = 0.25;
var AUTOSEQ_TEMPO_TOP = 4.0;
var AUTOSEQ_AT_MIN = 125.0;
var AUTOSEQ_AT_MAX = 50.0;
var AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
var AUTOSEEK_AT_MIN = 25.0;
var AUTOSEEK_AT_MAX = 15.0;
var AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;
var Stretch = function (_AbstractFifoSamplePi2) {
  function Stretch(createBuffers) {
    var _this3;
    _classCallCheck(this, Stretch);
    _this3 = _callSuper(this, Stretch, [createBuffers]);
    _this3._quickSeek = true;
    _this3.midBufferDirty = false;
    _this3.midBuffer = null;
    _this3.overlapLength = 0;
    _this3.autoSeqSetting = true;
    _this3.autoSeekSetting = true;
    _this3._tempo = 1;
    _this3.setParameters(44100, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
    return _this3;
  }
  _inherits(Stretch, _AbstractFifoSamplePi2);
  return _createClass(Stretch, [{
    key: "clear",
    value: function clear() {
      _superPropGet(Stretch, "clear", this)([]);
      this.clearMidBuffer();
    }
  }, {
    key: "clearMidBuffer",
    value: function clearMidBuffer() {
      if (this.midBufferDirty) {
        this.midBufferDirty = false;
        this.midBuffer = null;
      }
    }
  }, {
    key: "setParameters",
    value: function setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
      if (sampleRate > 0) {
        this.sampleRate = sampleRate;
      }
      if (overlapMs > 0) {
        this.overlapMs = overlapMs;
      }
      if (sequenceMs > 0) {
        this.sequenceMs = sequenceMs;
        this.autoSeqSetting = false;
      } else {
        this.autoSeqSetting = true;
      }
      if (seekWindowMs > 0) {
        this.seekWindowMs = seekWindowMs;
        this.autoSeekSetting = false;
      } else {
        this.autoSeekSetting = true;
      }
      this.calculateSequenceParameters();
      this.calculateOverlapLength(this.overlapMs);
      this.tempo = this._tempo;
    }
  }, {
    key: "tempo",
    get: function get() {
      return this._tempo;
    },
    set: function set(newTempo) {
      var intskip;
      this._tempo = newTempo;
      this.calculateSequenceParameters();
      this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
      this.skipFract = 0;
      intskip = Math.floor(this.nominalSkip + 0.5);
      this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
    }
  }, {
    key: "inputChunkSize",
    get: function get() {
      return this.sampleReq;
    }
  }, {
    key: "outputChunkSize",
    get: function get() {
      return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);
    }
  }, {
    key: "calculateOverlapLength",
    value: function calculateOverlapLength() {
      var overlapInMsec = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      var newOvl;
      newOvl = this.sampleRate * overlapInMsec / 1000;
      newOvl = newOvl < 16 ? 16 : newOvl;
      newOvl -= newOvl % 8;
      this.overlapLength = newOvl;
      this.refMidBuffer = new Float32Array(this.overlapLength * 2);
      this.midBuffer = new Float32Array(this.overlapLength * 2);
    }
  }, {
    key: "checkLimits",
    value: function checkLimits(x, mi, ma) {
      return x < mi ? mi : x > ma ? ma : x;
    }
  }, {
    key: "calculateSequenceParameters",
    value: function calculateSequenceParameters() {
      var seq;
      var seek;
      if (this.autoSeqSetting) {
        seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
        seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
        this.sequenceMs = Math.floor(seq + 0.5);
      }
      if (this.autoSeekSetting) {
        seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
        seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
        this.seekWindowMs = Math.floor(seek + 0.5);
      }
      this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1000);
      this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1000);
    }
  }, {
    key: "quickSeek",
    set: function set(enable) {
      this._quickSeek = enable;
    }
  }, {
    key: "clone",
    value: function clone() {
      var result = new Stretch();
      result.tempo = this._tempo;
      result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this.overlapMs);
      return result;
    }
  }, {
    key: "seekBestOverlapPosition",
    value: function seekBestOverlapPosition() {
      return this._quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
    }
  }, {
    key: "seekBestOverlapPositionStereo",
    value: function seekBestOverlapPositionStereo() {
      var bestOffset;
      var bestCorrelation;
      var correlation;
      var i = 0;
      this.preCalculateCorrelationReferenceStereo();
      bestOffset = 0;
      bestCorrelation = Number.MIN_VALUE;
      for (; i < this.seekLength; i = i + 1) {
        correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer);
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = i;
        }
      }
      return bestOffset;
    }
  }, {
    key: "seekBestOverlapPositionStereoQuick",
    value: function seekBestOverlapPositionStereoQuick() {
      var bestOffset;
      var bestCorrelation;
      var correlation;
      var scanCount = 0;
      var correlationOffset;
      var tempOffset;
      this.preCalculateCorrelationReferenceStereo();
      bestCorrelation = Number.MIN_VALUE;
      bestOffset = 0;
      correlationOffset = 0;
      tempOffset = 0;
      for (; scanCount < 4; scanCount = scanCount + 1) {
        var j = 0;
        while (_SCAN_OFFSETS[scanCount][j]) {
          tempOffset = correlationOffset + _SCAN_OFFSETS[scanCount][j];
          if (tempOffset >= this.seekLength) {
            break;
          }
          correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer);
          if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = tempOffset;
          }
          j = j + 1;
        }
        correlationOffset = bestOffset;
      }
      return bestOffset;
    }
  }, {
    key: "preCalculateCorrelationReferenceStereo",
    value: function preCalculateCorrelationReferenceStereo() {
      var i = 0;
      var context;
      var temp;
      for (; i < this.overlapLength; i = i + 1) {
        temp = i * (this.overlapLength - i);
        context = i * 2;
        this.refMidBuffer[context] = this.midBuffer[context] * temp;
        this.refMidBuffer[context + 1] = this.midBuffer[context + 1] * temp;
      }
    }
  }, {
    key: "calculateCrossCorrelationStereo",
    value: function calculateCrossCorrelationStereo(mixingPosition, compare) {
      var mixing = this._inputBuffer.vector;
      mixingPosition += this._inputBuffer.startIndex;
      var correlation = 0;
      var i = 2;
      var calcLength = 2 * this.overlapLength;
      var mixingOffset;
      for (; i < calcLength; i = i + 2) {
        mixingOffset = i + mixingPosition;
        correlation += mixing[mixingOffset] * compare[i] + mixing[mixingOffset + 1] * compare[i + 1];
      }
      return correlation;
    }
  }, {
    key: "overlap",
    value: function overlap(overlapPosition) {
      this.overlapStereo(2 * overlapPosition);
    }
  }, {
    key: "overlapStereo",
    value: function overlapStereo(inputPosition) {
      var input = this._inputBuffer.vector;
      inputPosition += this._inputBuffer.startIndex;
      var output = this._outputBuffer.vector;
      var outputPosition = this._outputBuffer.endIndex;
      var i = 0;
      var context;
      var tempFrame;
      var frameScale = 1 / this.overlapLength;
      var fi;
      var inputOffset;
      var outputOffset;
      for (; i < this.overlapLength; i = i + 1) {
        tempFrame = (this.overlapLength - i) * frameScale;
        fi = i * frameScale;
        context = 2 * i;
        inputOffset = context + inputPosition;
        outputOffset = context + outputPosition;
        output[outputOffset + 0] = input[inputOffset + 0] * fi + this.midBuffer[context + 0] * tempFrame;
        output[outputOffset + 1] = input[inputOffset + 1] * fi + this.midBuffer[context + 1] * tempFrame;
      }
    }
  }, {
    key: "process",
    value: function process() {
      var offset;
      var temp;
      var overlapSkip;
      if (this.midBuffer === null) {
        if (this._inputBuffer.frameCount < this.overlapLength) {
          return;
        }
        this.midBuffer = new Float32Array(this.overlapLength * 2);
        this._inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
      }
      while (this._inputBuffer.frameCount >= this.sampleReq) {
        offset = this.seekBestOverlapPosition();
        this._outputBuffer.ensureAdditionalCapacity(this.overlapLength);
        this.overlap(Math.floor(offset));
        this._outputBuffer.put(this.overlapLength);
        temp = this.seekWindowLength - 2 * this.overlapLength;
        if (temp > 0) {
          this._outputBuffer.putBuffer(this._inputBuffer, offset + this.overlapLength, temp);
        }
        var start = this._inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
        this.midBuffer.set(this._inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));
        this.skipFract += this.nominalSkip;
        overlapSkip = Math.floor(this.skipFract);
        this.skipFract -= overlapSkip;
        this._inputBuffer.receive(overlapSkip);
      }
    }
  }]);
}(AbstractFifoSamplePipe);
var testFloatEqual = function testFloatEqual(a, b) {
  return (a > b ? a - b : b - a) > 1e-10;
};
var SoundTouch = function () {
  function SoundTouch() {
    _classCallCheck(this, SoundTouch);
    this.transposer = new RateTransposer(false);
    this.stretch = new Stretch(false);
    this._inputBuffer = new FifoSampleBuffer();
    this._intermediateBuffer = new FifoSampleBuffer();
    this._outputBuffer = new FifoSampleBuffer();
    this._rate = 0;
    this._tempo = 0;
    this.virtualPitch = 1.0;
    this.virtualRate = 1.0;
    this.virtualTempo = 1.0;
    this.calculateEffectiveRateAndTempo();
  }
  return _createClass(SoundTouch, [{
    key: "clear",
    value: function clear() {
      this.transposer.clear();
      this.stretch.clear();
    }
  }, {
    key: "clone",
    value: function clone() {
      var result = new SoundTouch();
      result.rate = this.rate;
      result.tempo = this.tempo;
      return result;
    }
  }, {
    key: "rate",
    get: function get() {
      return this._rate;
    },
    set: function set(rate) {
      this.virtualRate = rate;
      this.calculateEffectiveRateAndTempo();
    }
  }, {
    key: "rateChange",
    set: function set(rateChange) {
      this._rate = 1.0 + 0.01 * rateChange;
    }
  }, {
    key: "tempo",
    get: function get() {
      return this._tempo;
    },
    set: function set(tempo) {
      this.virtualTempo = tempo;
      this.calculateEffectiveRateAndTempo();
    }
  }, {
    key: "tempoChange",
    set: function set(tempoChange) {
      this.tempo = 1.0 + 0.01 * tempoChange;
    }
  }, {
    key: "pitch",
    set: function set(pitch) {
      this.virtualPitch = pitch;
      this.calculateEffectiveRateAndTempo();
    }
  }, {
    key: "pitchOctaves",
    set: function set(pitchOctaves) {
      this.pitch = Math.exp(0.69314718056 * pitchOctaves);
      this.calculateEffectiveRateAndTempo();
    }
  }, {
    key: "pitchSemitones",
    set: function set(pitchSemitones) {
      this.pitchOctaves = pitchSemitones / 12.0;
    }
  }, {
    key: "inputBuffer",
    get: function get() {
      return this._inputBuffer;
    }
  }, {
    key: "outputBuffer",
    get: function get() {
      return this._outputBuffer;
    }
  }, {
    key: "calculateEffectiveRateAndTempo",
    value: function calculateEffectiveRateAndTempo() {
      var previousTempo = this._tempo;
      var previousRate = this._rate;
      this._tempo = this.virtualTempo / this.virtualPitch;
      this._rate = this.virtualRate * this.virtualPitch;
      if (testFloatEqual(this._tempo, previousTempo)) {
        this.stretch.tempo = this._tempo;
      }
      if (testFloatEqual(this._rate, previousRate)) {
        this.transposer.rate = this._rate;
      }
      if (this._rate > 1.0) {
        if (this._outputBuffer != this.transposer.outputBuffer) {
          this.stretch.inputBuffer = this._inputBuffer;
          this.stretch.outputBuffer = this._intermediateBuffer;
          this.transposer.inputBuffer = this._intermediateBuffer;
          this.transposer.outputBuffer = this._outputBuffer;
        }
      } else {
        if (this._outputBuffer != this.stretch.outputBuffer) {
          this.transposer.inputBuffer = this._inputBuffer;
          this.transposer.outputBuffer = this._intermediateBuffer;
          this.stretch.inputBuffer = this._intermediateBuffer;
          this.stretch.outputBuffer = this._outputBuffer;
        }
      }
    }
  }, {
    key: "process",
    value: function process() {
      if (this._rate > 1.0) {
        this.stretch.process();
        this.transposer.process();
      } else {
        this.transposer.process();
        this.stretch.process();
      }
    }
  }]);
}();
var WebAudioBufferSource = function () {
  function WebAudioBufferSource(buffer) {
    _classCallCheck(this, WebAudioBufferSource);
    this.buffer = buffer;
    this._position = 0;
  }
  return _createClass(WebAudioBufferSource, [{
    key: "dualChannel",
    get: function get() {
      return this.buffer.numberOfChannels > 1;
    }
  }, {
    key: "position",
    get: function get() {
      return this._position;
    },
    set: function set(value) {
      this._position = value;
    }
  }, {
    key: "extract",
    value: function extract(target) {
      var numFrames = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      var position = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
      this.position = position;
      var left = this.buffer.getChannelData(0);
      var right = this.dualChannel ? this.buffer.getChannelData(1) : this.buffer.getChannelData(0);
      var i = 0;
      for (; i < numFrames; i++) {
        target[i * 2] = left[i + position];
        target[i * 2 + 1] = right[i + position];
      }
      return Math.min(numFrames, left.length - position);
    }
  }]);
}();
var getWebAudioNode = function getWebAudioNode(context, filter) {
  var sourcePositionCallback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : noop;
  var bufferSize = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 4096;
  var node = context.createScriptProcessor(bufferSize, 2, 2);
  var samples = new Float32Array(bufferSize * 2);
  node.onaudioprocess = function (event) {
    var left = event.outputBuffer.getChannelData(0);
    var right = event.outputBuffer.getChannelData(1);
    var framesExtracted = filter.extract(samples, bufferSize);
    sourcePositionCallback(filter.sourcePosition);
    if (framesExtracted === 0) {
      filter.onEnd();
    }
    var i = 0;
    for (; i < framesExtracted; i++) {
      left[i] = samples[i * 2];
      right[i] = samples[i * 2 + 1];
    }
  };
  return node;
};
var pad = function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
};
var minsSecs = function minsSecs(secs) {
  var mins = Math.floor(secs / 60);
  var seconds = secs - mins * 60;
  return "".concat(mins, ":").concat(pad(parseInt(seconds), 2));
};
var onUpdate = function onUpdate(sourcePosition) {
  var currentTimePlayed = this.timePlayed;
  var sampleRate = this.sampleRate;
  this.sourcePosition = sourcePosition;
  this.timePlayed = sourcePosition / sampleRate;
  if (currentTimePlayed !== this.timePlayed) {
    var timePlayed = new CustomEvent('play', {
      detail: {
        timePlayed: this.timePlayed,
        formattedTimePlayed: this.formattedTimePlayed,
        percentagePlayed: this.percentagePlayed
      }
    });
    this._node.dispatchEvent(timePlayed);
  }
};
(function () {
  function PitchShifter(context, buffer, bufferSize) {
    var _this4 = this;
    var onEnd = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : noop;
    _classCallCheck(this, PitchShifter);
    this._soundtouch = new SoundTouch();
    var source = new WebAudioBufferSource(buffer);
    this.timePlayed = 0;
    this.sourcePosition = 0;
    this._filter = new SimpleFilter(source, this._soundtouch, onEnd);
    this._node = getWebAudioNode(context, this._filter, function (sourcePostion) {
      return onUpdate.call(_this4, sourcePostion);
    }, bufferSize);
    this.tempo = 1;
    this.rate = 1;
    this.duration = buffer.duration;
    this.sampleRate = context.sampleRate;
    this.listeners = [];
  }
  return _createClass(PitchShifter, [{
    key: "formattedDuration",
    get: function get() {
      return minsSecs(this.duration);
    }
  }, {
    key: "formattedTimePlayed",
    get: function get() {
      return minsSecs(this.timePlayed);
    }
  }, {
    key: "percentagePlayed",
    get: function get() {
      return 100 * this._filter.sourcePosition / (this.duration * this.sampleRate);
    },
    set: function set(perc) {
      this._filter.sourcePosition = parseInt(perc * this.duration * this.sampleRate);
      this.sourcePosition = this._filter.sourcePosition;
      this.timePlayed = this.sourcePosition / this.sampleRate;
    }
  }, {
    key: "node",
    get: function get() {
      return this._node;
    }
  }, {
    key: "pitch",
    set: function set(pitch) {
      this._soundtouch.pitch = pitch;
    }
  }, {
    key: "pitchSemitones",
    set: function set(semitone) {
      this._soundtouch.pitchSemitones = semitone;
    }
  }, {
    key: "rate",
    set: function set(rate) {
      this._soundtouch.rate = rate;
    }
  }, {
    key: "tempo",
    set: function set(tempo) {
      this._soundtouch.tempo = tempo;
    }
  }, {
    key: "connect",
    value: function connect(toNode) {
      this._node.connect(toNode);
    }
  }, {
    key: "disconnect",
    value: function disconnect() {
      this._node.disconnect();
    }
  }, {
    key: "on",
    value: function on(eventName, cb) {
      this.listeners.push({
        name: eventName,
        cb: cb
      });
      this._node.addEventListener(eventName, function (event) {
        return cb(event.detail);
      });
    }
  }, {
    key: "off",
    value: function off() {
      var _this5 = this;
      var eventName = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
      var listeners = this.listeners;
      if (eventName) {
        listeners = listeners.filter(function (e) {
          return e.name === eventName;
        });
      }
      listeners.forEach(function (e) {
        _this5._node.removeEventListener(e.name, function (event) {
          return e.cb(event.detail);
        });
      });
    }
  }]);
})();

var SoundTouchWorklet = function (_AudioWorkletProcesso) {
  function SoundTouchWorklet() {
    var _this;
    _classCallCheck(this, SoundTouchWorklet);
    _this = _callSuper(this, SoundTouchWorklet);
    _this.bufferSize = 128;
    _this._samples = new Float32Array(_this.bufferSize * 2);
    _this._pipe = new SoundTouch();
    return _this;
  }
  _inherits(SoundTouchWorklet, _AudioWorkletProcesso);
  return _createClass(SoundTouchWorklet, [{
    key: "process",
    value: function process(inputs, outputs, parameters) {
      var _parameters$rate$, _parameters$tempo$, _parameters$pitch$, _parameters$pitchSemi;
      if (!inputs[0].length) return true;
      var leftInput = inputs[0][0];
      var rightInput = inputs[0].length > 1 ? inputs[0][1] : inputs[0][0];
      var leftOutput = outputs[0][0];
      var rightOutput = outputs[0].length > 1 ? outputs[0][1] : outputs[0][0];
      var samples = this._samples;
      if (!leftOutput || !leftOutput.length) return false;
      var rate = (_parameters$rate$ = parameters.rate[0]) !== null && _parameters$rate$ !== void 0 ? _parameters$rate$ : parameters.rate;
      var tempo = (_parameters$tempo$ = parameters.tempo[0]) !== null && _parameters$tempo$ !== void 0 ? _parameters$tempo$ : parameters.tempo;
      var pitch = (_parameters$pitch$ = parameters.pitch[0]) !== null && _parameters$pitch$ !== void 0 ? _parameters$pitch$ : parameters.pitch;
      var pitchSemitones = (_parameters$pitchSemi = parameters.pitchSemitones[0]) !== null && _parameters$pitchSemi !== void 0 ? _parameters$pitchSemi : parameters.pitchSemitones;
      this._pipe.rate = rate;
      this._pipe.tempo = tempo;
      this._pipe.pitch = pitch * Math.pow(2, pitchSemitones / 12);
      for (var i = 0; i < leftInput.length; i++) {
        samples[i * 2] = leftInput[i];
        samples[i * 2 + 1] = rightInput[i];
      }
      this._pipe.inputBuffer.putSamples(samples, 0, leftInput.length);
      this._pipe.process();
      var processedSamples = new Float32Array(leftInput.length * 2);
      this._pipe.outputBuffer.receiveSamples(processedSamples, leftOutput.length);
      for (var _i = 0; _i < leftInput.length; _i++) {
        leftOutput[_i] = processedSamples[_i * 2];
        rightOutput[_i] = processedSamples[_i * 2 + 1];
        if (isNaN(leftOutput[_i]) || isNaN(rightOutput[_i])) {
          leftOutput[_i] = 0;
          rightOutput[_i] = 0;
        }
      }
      return true;
    }
  }], [{
    key: "parameterDescriptors",
    get: function get() {
      return [{
        name: 'rate',
        defaultValue: 1.0,
        minValue: 0.25,
        maxValue: 4.0
      }, {
        name: 'tempo',
        defaultValue: 1.0,
        minValue: 0.25,
        maxValue: 4.0
      }, {
        name: 'pitch',
        defaultValue: 1.0,
        minValue: 0.25,
        maxValue: 4.0
      }, {
        name: 'pitchSemitones',
        defaultValue: 0,
        minValue: -24,
        maxValue: 24
      }];
    }
  }]);
}(_wrapNativeSuper(AudioWorkletProcessor));
registerProcessor('soundtouch-processor', SoundTouchWorklet);
