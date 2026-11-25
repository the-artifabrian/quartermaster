/**
 * Singular or plural for a scaled Recipe line or yield: "2 eggs", "2 pinches
 * salt", "Makes 2 loaves". Only words on the list below change, so a mass
 * noun ("salt"), an abbreviation ("tbsp") or a word in another language stays
 * as the author wrote it. At 1× nothing changes. Client-safe.
 */
import { isRangeAmount, parseAmount, parseRangeAmount } from './fractions.ts'
import { PRODUCE_WORD_FORMS } from './produce-weights.ts'

// Units that count something, singular first. One of these at the start of
// a name with no unit ("2 tins chopped tomatoes") is what the amount counts.
const COUNT_UNITS: Array<[string, string]> = [
	['bag', 'bags'],
	['bottle', 'bottles'],
	['box', 'boxes'],
	['bunch', 'bunches'],
	['can', 'cans'],
	['clove', 'cloves'],
	['cube', 'cubes'],
	['cup', 'cups'],
	['dash', 'dashes'],
	['drop', 'drops'],
	['gallon', 'gallons'],
	['gram', 'grams'],
	['half', 'halves'],
	['handful', 'handfuls'],
	['head', 'heads'],
	['jar', 'jars'],
	['kilogram', 'kilograms'],
	['knob', 'knobs'],
	['liter', 'liters'],
	['litre', 'litres'],
	['milliliter', 'milliliters'],
	['millilitre', 'millilitres'],
	['ounce', 'ounces'],
	['pack', 'packs'],
	['package', 'packages'],
	['packet', 'packets'],
	['piece', 'pieces'],
	['pinch', 'pinches'],
	['pint', 'pints'],
	['pound', 'pounds'],
	['quart', 'quarts'],
	['sheet', 'sheets'],
	['slice', 'slices'],
	['sprig', 'sprigs'],
	['stalk', 'stalks'],
	['stick', 'sticks'],
	['tablespoon', 'tablespoons'],
	['teaspoon', 'teaspoons'],
	['tin', 'tins'],
	['tub', 'tubs'],
	['wedge', 'wedges'],
	['punnet', 'punnets'],
	['carton', 'cartons'],
	['sachet', 'sachets'],
	['bulb', 'bulbs'],
	['block', 'blocks'],
]

// Count nouns and count units. Produce comes from the produce table; these
// are the rest a Recipe line or a yield tends to count in.
const WORD_FORMS: Array<[string, string]> = [
	...PRODUCE_WORD_FORMS,
	...COUNT_UNITS,
	// Things counted on their own
	['bagel', 'bagels'],
	['biscuit', 'biscuits'],
	['breast', 'breasts'],
	['bun', 'buns'],
	['cake', 'cakes'],
	['cherry', 'cherries'],
	['chilli', 'chillies'],
	['chili', 'chilies'],
	['chop', 'chops'],
	['cookie', 'cookies'],
	['courgette', 'courgettes'],
	['aubergine', 'aubergines'],
	['cutlet', 'cutlets'],
	['date', 'dates'],
	['drumstick', 'drumsticks'],
	['egg', 'eggs'],
	['fig', 'figs'],
	['fillet', 'fillets'],
	['leaf', 'leaves'],
	['leek', 'leeks'],
	['loaf', 'loaves'],
	['muffin', 'muffins'],
	['mushroom', 'mushrooms'],
	['pancake', 'pancakes'],
	['pepper', 'peppers'],
	['person', 'people'],
	['pie', 'pies'],
	['pitta', 'pittas'],
	['pizza', 'pizzas'],
	['plum', 'plums'],
	['portion', 'portions'],
	['prawn', 'prawns'],
	['radish', 'radishes'],
	['rasher', 'rashers'],
	['roll', 'rolls'],
	['sausage', 'sausages'],
	['serving', 'servings'],
	['shallot', 'shallots'],
	['steak', 'steaks'],
	['thigh', 'thighs'],
	['tomato', 'tomatoes'],
	['tortilla', 'tortillas'],
	['wing', 'wings'],
	['wrap', 'wraps'],
	['yolk', 'yolks'],
]

// Each word, either form, to its two forms. Only the last word of a produce
// name counts ("cherry tomato" gives "tomato"), as only the last word changes.
const FORMS = new Map<string, { one: string; many: string }>()
for (const [singular, plural] of WORD_FORMS) {
	const one = singular.split(' ').at(-1)!
	const many = plural.split(' ').at(-1)!
	const forms = { one, many }
	if (!FORMS.has(one)) FORMS.set(one, forms)
	if (!FORMS.has(many)) FORMS.set(many, forms)
}

const UNIT_WORDS = new Set(COUNT_UNITS.flat())

/** One word in the form `count` asks for, keeping its capitals. */
function inflectWord(word: string, count: number): string {
	const forms = FORMS.get(word.toLowerCase())
	if (!forms) return word
	const target = count > 1 ? forms.many : forms.one
	if (word === word.toUpperCase() && word.length > 1) {
		return target.toUpperCase()
	}
	if (word[0] !== word[0]!.toLowerCase()) {
		return target[0]!.toUpperCase() + target.slice(1)
	}
	return target
}

/**
 * The noun a phrase counts, in the form `count` asks for. That is the last
 * word before any note (after a comma or bracket) and before any "of"
 * ("slices of cake" counts slices).
 */
function inflectPhrase(phrase: string, count: number): string {
	const noteAt = phrase.search(/[,(]/)
	const head = noteAt === -1 ? phrase : phrase.slice(0, noteAt)
	const rest = noteAt === -1 ? '' : phrase.slice(noteAt)
	// "tins chopped tomatoes" counts tins.
	const lead = /^(\s*)(\p{L}+)(\s)/u.exec(head)
	if (lead && UNIT_WORDS.has(lead[2]!.toLowerCase())) {
		return (
			lead[1] +
			inflectWord(lead[2]!, count) +
			phrase.slice(lead[1]!.length + lead[2]!.length)
		)
	}
	const ofAt = head.search(/\sof\s/i)
	const counted = ofAt === -1 ? head : head.slice(0, ofAt)
	const after = ofAt === -1 ? '' : head.slice(ofAt)
	const match = /(\p{L}+)(\s*)$/u.exec(counted)
	if (!match) return phrase
	const word = match[1]!
	const before = counted.slice(0, match.index)
	return before + inflectWord(word, count) + match[2] + after + rest
}

/**
 * How many of something a scaled amount is, by a range's high end. Within
 * 0.05 of a whole number it is that number, as kitchen rounding shows it
 * (3 eggs at 0.34× reads "1").
 */
function scaledCount(amount: string, ratio: number): number | null {
	let value: number | null
	if (isRangeAmount(amount)) {
		const range = parseRangeAmount(amount)
		value = range ? range.high * ratio : null
	} else {
		const parsed = parseAmount(amount)
		value = parsed === null ? null : parsed * ratio
	}
	if (value === null) return null
	const whole = Math.round(value)
	return Math.abs(value - whole) < 0.05 ? whole : value
}

/**
 * The unit and name of an ingredient line scaled by `ratio`. A line with a
 * unit counts in that unit ("2 pinches salt"); one without counts its noun
 * ("2 eggs"). At 1×, or when the amount isn't a number, the line is as
 * written.
 */
export function scaledLineWords(
	line: { amount: string | null; unit: string | null; name: string },
	ratio: number,
): { unit: string | null; name: string } {
	const { unit, name } = line
	if (ratio === 1 || !line.amount) return { unit, name }
	const count = scaledCount(line.amount, ratio)
	if (count === null) return { unit, name }
	if (unit) return { unit: inflectPhrase(unit, count), name }
	return { unit, name: inflectPhrase(name, count) }
}

/** A yield label for `target` of it, made at `multiplier` times the Recipe. */
export function scaledYieldLabel(
	label: string,
	target: number,
	multiplier: number,
): string {
	return multiplier === 1 ? label : inflectPhrase(label, target)
}
