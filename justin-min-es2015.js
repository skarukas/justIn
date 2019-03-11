/*
JustIn: Adaptive just intonation system for MIDI pitches. 

Version for JS object in Max/MSP (ES2015)

Copyright Stephen Karukas, 2019
*/

//=====Output=====

/*
This program outputs the following messages:

"noteControl" pitch (Integer 0-127), velocity (Integer 0-127)
    -for controlling note-ons and offs. Essentially acts as a MIDI "thru" for the equal-tempered pitches, 
        as MIDI does not support floating-point values.

"noteMessage" targetPitch (Integer 0-127), bend (Number)
    -specifices what already held pitch to target, and the decimal value that should be added to justly tune it

"offset" offset (Number)
    -the amount of cents the system has been transposed.

"done"
    -outputs when note processing has finished (for measuring latency).

*/

// sends messages to Max
function output() {
  var args = Array.prototype.slice.call(arguments);
  outlet(0, args);
} 

// posts errors to the Max console
function postError(err) {
  post(err + "\n");
} 

//================Variables================

// An intensity is a ratio (0.-1.) that determines how much the intervals will be corrected.
var intensity = 0.75;

/*
meanMode is a Boolean value.
    -when true, every reevaluation of the chord puts the justly tuned chord directly between 
        the equal tempered pitches, making microtonal steps between chords smaller
        example: playing a major 3rd will raise the low pitch by 7 cents and lower the high pitch by 7 cents 
    -when false, the lowest pitch is always presented in its 12TET value
        example: playing a major 3rd will lower the high pitch by 14 cents 
*/
var meanMode = true; 

//======Arrays======

// heldNotes is an Array of Note objects for each note currently active
var heldNotes = []; 

// justIntervals is an Array of 12 Numbers corresponding to justly-tuned 
//      versions of the possible chromatic intervals from a reference pitch
var justIntervals = []; 

// justOrder is an Array of 12 integers representing intervals, ascending by Order.
var justOrder = [];

/* 
an Order is an integer that represents the percieved consonance of an interval.
    -N.B. the included Limit.order values are roughly based on the harmonic series, though 
    they are slightly arbitrary.
*/
//======Objects======

/* 
a Note is an object containing:
-equalPitch : the MIDI pitch originally sent into the program
-justPitch : a modified version of equalPitch that results in
            justly tuned intervals with other held pitches
-order : the Order of the interval that made the most recent 
        change to justPitch
-velocity : the MIDI velocity sent into the program 
*/
function Note(_pitch, _velocity) {
  this.equalPitch = _pitch;
  this.justPitch = _pitch;
  this.order = -1;
  this.velocity = _velocity;
}


/*
a Limit is an object containing:
-intervals : an Array with the same properties as justIntervals
-order : an Array with the same properties as justOrder
*/
function Limit(_intervals, _order) {
  this.intervals = _intervals;
  this.order = _order;
}

var justSystem = [];
/*
a JustObj is an object containing:
-intervals : an Array with the same properties as justIntervals
-order : an Array with the same properties as justOrder
*/

function JustObj(equalInterval, justInterval, order) {
  this.equalInterval = equalInterval;
  this.justInterval = justInterval;
  this.order = order;
}

//====Limits====

var fiveLimit = [
  new JustObj(0, 0, 11), 
  new JustObj(1, 1.12, 1), 
  new JustObj(2, 2.04, 6), 
  new JustObj(3, 3.16, 10), 
  new JustObj(4, 3.86, 2), 
  new JustObj(5, 4.98, 9), 
  new JustObj(6, 5.9, 3), 
  new JustObj(7, 7.02, 8), 
  new JustObj(8, 8.14, 4), 
  new JustObj(9, 8.84, 5), 
  new JustObj(10, 9.96, 7), 
  new JustObj(11, 10.88, 0)];

var sevenLimit = [
  new JustObj(0, 0, 11), 
  new JustObj(1, 1.12, 1), 
  new JustObj(2, 2.04, 6), 
  new JustObj(3, 3.16, 9), 
  new JustObj(4, 3.86, 3), 
  new JustObj(5, 4.98, 2), 
  new JustObj(6, 5.9, 10), 
  new JustObj(7, 7.02, 8), 
  new JustObj(8, 8.14, 4), 
  new JustObj(9, 8.84, 5), 
  new JustObj(10, 9.69, 7), 
  new JustObj(11, 10.88, 0)]; 
  
var elevenLimit = [
  new JustObj(0, 0, 11), 
  new JustObj(1, 1.12, 1), 
  new JustObj(2, 2.04, 9), 
  new JustObj(3, 3.16, 3), 
  new JustObj(4, 3.86, 2), 
  new JustObj(5, 4.98, 6), 
  new JustObj(6, 5.51, 10), 
  new JustObj(7, 7.02, 8), 
  new JustObj(8, 8.14, 4), 
  new JustObj(9, 8.84, 5), 
  new JustObj(10, 9.69, 7), 
  new JustObj(11, 10.88, 0)]; 

var thirteenLimit = [
  new JustObj(0, 0, 11), 
  new JustObj(1, 1.12, 1), 
  new JustObj(2, 2.04, 9), 
  new JustObj(3, 3.16, 3), 
  new JustObj(4, 3.86, 2), 
  new JustObj(5, 4.98, 6), 
  new JustObj(6, 5.51, 10), 
  new JustObj(7, 7.02, 8), 
  new JustObj(8, 8.40, 4), 
  new JustObj(9, 8.84, 5), 
  new JustObj(10, 9.69, 7), 
  new JustObj(11, 10.88, 0)]; 

setLimit(5); 

//sets the JI limit to use (order values are a bit arbitrary, but they seem to work well in most situations)
function setLimit(val) {
  switch (val) {
    case 5:
      justSystem = fiveLimit;
      break;
    case 7:
      justSystem = sevenLimit;
      break;
    case 11:
      justSystem = elevenLimit;
      break;
    case 13:
      justSystem = thirteenLimit;
      break;
    default:
      postError('Tuning not available.\nValid arguments: 5, 7, 11, 13');
  }
  justify();
} 

// sets the meanMode value (Boolean)
function setMeanMode(bool) {
  if (bool == false) {
    meanMode = false;
  } else if (bool == true) {
    meanMode = true;
  } else {
    postError('Not valid.\nValid arguments: 1 or true, 0 or false');
  }
} 

// clamps a value to a min and max value
Number.prototype.clamp = function (min, max) {
  return Math.min(Math.max(this, min), max);
}; 

// sets the intensity of pitch correction
function setIntensity(val) {
  intensity = val; //.clamp(0, 1); just for funzies now you can have extreme amounts of "correction"
  adjustPitches(heldNotes);
  allNoteMsgOut();
} 

// sends a message noteControl to the synthesizer.
// noteControl:
// -pitch : MIDI pitch (0-127)
// -velocity : MIDI velocity (0-127)
function noteCtrlOut(pitch, velocity) {
  output('noteControl', pitch, velocity);
} 

// sends a message noteMessage to the synthesizer.
// noteMessage:
// -pitch : target MIDI pitch (0-127)
// -bend : amount of correction in semitones scaled by intensity
function noteMsgOut(pitch, bend) {
  output('noteMessage', pitch, bend * intensity);
} 

// sends noteMessages for every held note
function allNoteMsgOut() {
  heldNotes.forEach(function (obj) {
    noteMsgOut(obj.equalPitch, obj.justPitch - obj.equalPitch);
  });
  justCompOut();
} 

// adds a Note to heldNotes[]
function addNote(pitch, velocity) {
  heldNotes.push(new Note(pitch, velocity));
} 

// removes a Note from heldNotes[]
function removeNote(n) {
  heldNotes.splice(n, 1);
} 

// adds or removes a Note from heldNotes[]
function noteHandler(pitch, velocity) {
  var isNoteOn = velocity > 0;
  if (isNoteOn) {
    addNote(pitch, velocity);
  } else if (!isNoteOn) {
    for (i = 0; i < heldNotes.length; i++) {
      if (pitch === heldNotes[i].equalPitch) {
        removeNote(i);
      }
    }
  }
} 

// main function--processes incoming MIDI notes, sending out noteControls (MIDI notes) 
//      and noteMessages (pitch bend for each note).
function noteIn(pitch, velocity) {
  noteCtrlOut(pitch, velocity);
  noteHandler(pitch, velocity);
  justify();
  allNoteMsgOut();
  output('done');
} 

// sends note-offs then empties the array
function allNotesOff() {
  heldNotes.forEach(function (obj) {
    noteCtrlOut(obj.equalPitch, 0);
  });
  heldNotes = [];
} 

// clears all notes and resets globalPitchOffset
function clearNotes() {
  allNotesOff();
} 

// modifies heldNotes to account for just intonation
function justify() {
  if (heldNotes[0]) {
    fixedJustify();
  }
} 

// fixedJustify and helpers
function fixedJustify() {
  resetJustPitches(heldNotes);

  if (heldNotes.length > 1) {
    sortPitchesAscending(heldNotes);
    adjustPitches(heldNotes);

    if (meanMode) {
      meanAdjust(heldNotes);
    }
  }
} 

// resets all Note properties in Array to their default values
function resetJustPitches(noteArr) {
  var numNotes = noteArr.length;

  for (i = 0; i < numNotes; i++) {
    noteArr[i].justPitch = noteArr[i].equalPitch;
    noteArr[i].order = -1;
  }
} 

// puts [ArrayOf Note] in ascending order by equalPitch
function sortPitchesAscending(noteArr) {
  noteArr.sort(function (a, b) {
    return a.equalPitch - b.equalPitch;
  });
} 

// compares all members of a sorted [ArrayOf Note], adjusting a Note's justPitch 
//      to create intervals of the highest order with other members.
function adjustPitches(noteArr) {
  var numNotes = noteArr.length; 
  
  // lower pitched Note for comparison
  for (lo = 0; lo < numNotes - 1; lo++) {
    var LoNote = noteArr[lo]; 
    
    // higher pitched Note for comparison, starting at the next highest Note from lo
    for (hi = lo + 1; hi < numNotes; hi++) {
      var HiNote = noteArr[hi];
      var interval = HiNote.equalPitch - LoNote.equalPitch;
      var IntervalObj = justSystem[interval % 12];
      var intervalIsHigherOrder = IntervalObj.order > HiNote.order || IntervalObj.order > LoNote.order;

      // if the order of the interval is greater than an existing order, create the just interval between the two pitches
      if (intervalIsHigherOrder) {
        var compoundJustInterval = (IntervalObj.justInterval - (interval % 12)) + interval;
        createInterval(HiNote, LoNote, compoundJustInterval);
        updateOrder(HiNote, IntervalObj.order);
        updateOrder(LoNote, IntervalObj.order);
      }
    }
  }
}

/**
 * creates an interval between two Notes, offsetting the pitch of whichever has a lower order
 * 
 * @param {Note} Lo 
 * @param {Note} Hi 
 * @param {Number} interval    the interval to be subtracted or added
 */
function createInterval(Hi, Lo, interval) {
  if (Hi.order > Lo.order) {
    // adjust the lower Note's justPitch (and order)
    Lo.justPitch = Hi.justPitch - interval;
  } else {
    // adjust the higher Note's justPitch (and order)
    Hi.justPitch = Lo.justPitch + interval;
  }
} 

// updates an Note's order if it is higher than queryOrder
function updateOrder(N, order) {
  if (order > N.order) {
    N.order = order;
  }
} 

// alters justPitches so that the mean of all justPitches equals the mean of all equalPitches.
// -this causes smaller pitch differences from equal temperament, and therefore reduces the 
// size of microtonal steps between chords as well (see meanMode definition)
function meanAdjust() {
  var equalTotal = 0;
  var justTotal = 0;
  var numNotes = heldNotes.length;

  for (i = 0; i < numNotes; i++) {
    equalTotal += heldNotes[i].equalPitch;
    justTotal += heldNotes[i].justPitch;
  }
  
  // meanOffset is a Number representing the amount (in semitones) all pitches will be shifted
  var meanOffset = (equalTotal - justTotal) / numNotes;
  offsetAllPitches(meanOffset);
} 

// transposes all justPitches by an offset in semitones
function offsetAllPitches(offset) {
  var numNotes = heldNotes.length;
  for (i = 0; i < numNotes; i++) {
    heldNotes[i].justPitch += offset;
  }
}

// JI comparison: for demonstration purposes
function justCompOut() {
  pitchListsOut();
  offsetOctaveOut();
  offsetListOut();
}

// outputs lists of all equal and just pitches
function pitchListsOut() {
  // a list of all justPitches (String)
  var justList = heldNotes.map(function(N) {
    return ((N.justPitch - N.equalPitch) * intensity) + N.equalPitch;
  }).join(" ");

  // a list of all equalPitches (String)
  var equalList = heldNotes.map(function(N) {
    return N.equalPitch;
  }).join(" ");

  output("justPitches", justList);
  output("equalPitches", equalList);
}

// sends out a list of the offset of every pitch in an octave
function offsetOctaveOut() {
  var offsetArr = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (i = 0; i < heldNotes.length; i++) {
    var N = heldNotes[i];
    offsetArr[N.equalPitch % 12] = (N.justPitch - N.equalPitch) * intensity;
  }
  output("offsetOctave", offsetArr.join(" "));
}

// sends out a list of the offset of every pitch in the heldNotes Array
function offsetListOut() {
  var offsetArr = [];
  for (i = 0; i < heldNotes.length; i++) {
    var N = heldNotes[i];
    offsetArr.push((N.justPitch - N.equalPitch) * intensity);
  }
  output("offsetList", offsetArr.join(" "));
}


// makes it so that numbers slightly lower than 0 will go into negative range instead of jumping up to 11.99
function modCorrect(num) {
  if (num > 11.5) {
    return num - 12;
  } else {
    return num;
  }
}