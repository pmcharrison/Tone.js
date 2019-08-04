import { ToneAudioBuffer } from "../core/context/ToneAudioBuffer";
import { ToneAudioBuffers } from "../core/context/ToneAudioBuffers";
import { intervalToFrequencyRatio } from "../core/type/Conversions";
import { FrequencyClass } from "../core/type/Frequency";
import { Frequency, Interval, MidiNote, NormalRange, Note, Time } from "../core/type/Units";
import { optionsFromArguments } from "../core/util/Defaults";
import { noOp } from "../core/util/Interface";
import { isArray, isNote, isNumber, isString } from "../core/util/TypeCheck";
import { Instrument, InstrumentOptions } from "../instrument/Instrument";
import { ToneBufferSource, ToneBufferSourceCurve } from "../source/buffer/BufferSource";

interface SamplesMap {
	[note: string]: ToneAudioBuffer | AudioBuffer | string;
	[midi: number]: ToneAudioBuffer | AudioBuffer | string;
}

interface SamplerOptions extends InstrumentOptions {
	attack: Time;
	release: Time;
	onload: () => void;
	baseUrl: string;
	curve: ToneBufferSourceCurve;
	urls: SamplesMap;
}

/**
 * Pass in an object which maps the note's pitch or midi value to the url,
 * then you can trigger the attack and release of that note like other instruments.
 * By automatically repitching the samples, it is possible to play pitches which
 * were not explicitly included which can save loading time.
 *
 * For sample or buffer playback where repitching is not necessary,
 * use {@link Player}.
 * @param samples An object of samples mapping either Midi
 *                         Note Numbers or Scientific Pitch Notation
 *                         to the url of that sample.
 * @param onload The callback to invoke when all of the samples are loaded.
 * @param baseUrl The root URL of all of the samples, which is prepended to all the URLs.
 * @example
 * var sampler = new Sampler({
 * 	"C3" : "path/to/C3.mp3",
 * 	"D#3" : "path/to/Dsharp3.mp3",
 * 	"F#3" : "path/to/Fsharp3.mp3",
 * 	"A3" : "path/to/A3.mp3",
 * }, function(){
 * 	//sampler will repitch the closest sample
 * 	sampler.triggerAttack("D3")
 * })
 */
export class Sampler extends Instrument<SamplerOptions> {

	name = "Sampler";

	/**
	 * The stored and loaded buffers
	 * @type {Tone.Buffers}
	 * @private
	 */
	private _buffers: ToneAudioBuffers;

	/**
	 * The object of all currently playing BufferSources
	 */
	private _activeSources: Map<MidiNote, ToneBufferSource[]> = new Map();

	/**
	 * The envelope applied to the beginning of the sample.
	 */
	attack: Time;

	/**
	 * The envelope applied to the end of the envelope.
	 */
	release: Time;

	/**
	 *  The shape of the attack/release curve.
	 *  Either "linear" or "exponential"
	 */
	curve: ToneBufferSourceCurve;

	constructor(options?: Partial<SamplerOptions>);
	constructor(samples?: SamplesMap, options?: Partial<Omit<SamplerOptions, "urls">>);
	constructor(samples?: SamplesMap, onload?: () => void, baseUrl?: string);
	constructor() {

		super(optionsFromArguments(Sampler.getDefaults(), arguments, ["urls", "onload", "baseUrl"], "urls"));
		const options = optionsFromArguments(Sampler.getDefaults(), arguments, ["urls", "onload", "baseUrl"], "urls");

		const urlMap = {};
		Object.keys(options.urls).forEach((note) => {
			const noteNumber = parseInt(note, 10);
			this.assert(isNote(note)
				|| (isNumber(noteNumber) && isFinite(noteNumber)), `url key is neither a note or midi pitch: ${note}`);
			if (isNote(note)) {
				// convert the note name to MIDI
				const mid = new FrequencyClass(this.context, note).toMidi();
				urlMap[mid] = options.urls[note];
			} else if (isNumber(noteNumber) && isFinite(noteNumber)) {
				// otherwise if it's numbers assume it's midi
				urlMap[noteNumber] = options.urls[noteNumber];
			}
		});

		this._buffers = new ToneAudioBuffers(urlMap, options.onload, options.baseUrl);
		this.attack = options.attack;
		this.release = options.release;
		this.curve = options.curve;
	}

	static getDefaults(): SamplerOptions {
		return Object.assign(Instrument.getDefaults(), {
			attack : 0,
			baseUrl : "",
			curve : "exponential" as "exponential",
			onload : noOp,
			release : 0.1,
			urls: {},
		});
	}

	/**
	 * Returns the difference in steps between the given midi note at the closets sample.
	 */
	private _findClosest(midi: MidiNote): Interval {
		// searches within 8 octaves of the given midi note
		const MAX_INTERVAL = 96;
		let interval = 0;
		while (interval < MAX_INTERVAL) {
			// check above and below
			if (this._buffers.has(midi + interval)) {
				return -interval;
			} else if (this._buffers.has(midi - interval)) {
				return interval;
			}
			interval++;
		}
		throw new Error(`No available buffers for note: ${midi}`);
	}

	/**
	 * @param  notes	The note to play, or an array of notes.
	 * @param  time     When to play the note
	 * @param  velocity The velocity to play the sample back.
	 */
	triggerAttack(notes: Frequency | Frequency[], time?: Time, velocity: NormalRange = 1): this {
		this.log("triggerAttack", notes, time, velocity);
		if (!Array.isArray(notes)) {
			notes = [notes];
		}
		notes.forEach(note => {
			const midi = new FrequencyClass(this.context, note).toMidi();
			// find the closest note pitch
			const difference = this._findClosest(midi);
			const closestNote = midi - difference;
			const buffer = this._buffers.get(closestNote);
			const playbackRate = intervalToFrequencyRatio(difference);
			// play that note
			const source = new ToneBufferSource({
				buffer,
				context: this.context,
				curve : this.curve,
				fadeIn : this.attack,
				fadeOut : this.release,
				playbackRate,
			}).connect(this.output);
			source.start(time, 0, buffer.duration / playbackRate, velocity);
			// add it to the active sources
			if (!isArray(this._activeSources.get(midi))) {
				this._activeSources.set(midi, []);
			}
			(this._activeSources.get(midi) as ToneBufferSource[]).push(source);

			// remove it when it's done
			source.onended = () => {
				if (this._activeSources && this._activeSources.has(midi)) {
					const sources = this._activeSources.get(midi) as ToneBufferSource[];
					const index = sources.indexOf(source);
					if (index !== -1) {
						sources.splice(index, 1);
					}
				}
			};
		});
		return this;
	}

	/**
	 * @param  notes	The note to release, or an array of notes.
	 * @param  time     	When to release the note.
	 */
	triggerRelease(notes: Frequency | Frequency[], time?: Time): this {
		this.log("triggerRelease", notes, time);
		if (!Array.isArray(notes)) {
			notes = [notes];
		}
		notes.forEach(note => {
			const midi = new FrequencyClass(this.context, note).toMidi();
			// find the note
			if (this._activeSources.has(midi) && (this._activeSources.get(midi) as ToneBufferSource[]).length) {
				const sources = this._activeSources.get(midi) as ToneBufferSource[];
				time = this.toSeconds(time);
				sources.forEach(source => {
					source.stop(time);
				});
				this._activeSources.set(midi, []);
			}
		});
		return this;
	}

	/**
	 * Release all currently active notes.
	 * @param  time     	When to release the notes.
	 */
	releaseAll(time?: Time): this {
		const computedTime = this.toSeconds(time);
		this._activeSources.forEach(sources => {
			while (sources.length) {
				const source = sources.shift() as ToneBufferSource;
				source.stop(computedTime);
			}
		});
		return this;
	}

	/**
	 * Sync the instrument to the Transport. All subsequent calls of
	 * [triggerAttack](#triggerattack) and [triggerRelease](#triggerrelease)
	 * will be scheduled along the transport.
	 * @example
	 * synth.sync()
	 * //schedule 3 notes when the transport first starts
	 * synth.triggerAttackRelease('8n', 0)
	 * synth.triggerAttackRelease('8n', '8n')
	 * synth.triggerAttackRelease('8n', '4n')
	 * //start the transport to hear the notes
	 * Transport.start()
	 * @returns {Tone.Instrument} this
	 */
	sync(): this {
		this._syncMethod("triggerAttack", 1);
		this._syncMethod("triggerRelease", 1);
		return this;
	}

	/**
	 * Invoke the attack phase, then after the duration, invoke the release.
	 * @param  notes	The note to play and release, or an array of notes.
	 * @param  duration The time the note should be held
	 * @param  time     When to start the attack
	 * @param  velocity The velocity of the attack
	 */
	triggerAttackRelease(
		notes: Frequency[] | Frequency,
		duration: Time | Time[],
		time?: Time,
		velocity: NormalRange = 1,
	): this {
		const computedTime = this.toSeconds(time);
		this.triggerAttack(notes, computedTime, velocity);
		if (isArray(duration)) {
			this.assert(isArray(notes), "notes must be an array when duration is array");
			(notes as Frequency[]).forEach((note, index) => {
				const d = duration[Math.min(index, duration.length - 1)];
				this.triggerRelease(note, computedTime + this.toSeconds(d));
			});
		} else {
			this.triggerRelease(notes, computedTime + this.toSeconds(duration));
		}
		return this;
	}

	/**
	 * Add a note to the sampler.
	 * @param  note      The buffer's pitch.
	 * @param  url  Either the url of the bufer, or a buffer which will be added with the given name.
	 * @param  callback  The callback to invoke when the url is loaded.
	 */
	add(note: Note | MidiNote, url: string | ToneAudioBuffer | AudioBuffer, callback?: () => void): this {
		this.assert(isNote(note) || isFinite(note), `note must be a pitch or midi: ${note}`);
		if (isNote(note)) {
			// convert the note name to MIDI
			const mid = new FrequencyClass(this.context, note).toMidi();
			this._buffers.add(mid, url, callback);
		} else {
			// otherwise if it's numbers assume it's midi
			this._buffers.add(note, url, callback);
		}
		return this;
	}

	/**
	 * If the buffers are loaded or not
	 */
	get loaded(): boolean {
		return this._buffers.loaded;
	}

	/**
	 * Clean up
	 */
	dispose(): this {
		super.dispose();
		this._buffers.dispose();
		this._activeSources.forEach(sources => {
			sources.forEach(source => source.dispose());
		});
		this._activeSources.clear();
		return this;
	}
}
