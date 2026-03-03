import { useCallback, useEffect, useRef, useState } from 'react'

export type TranscribedItem = {
	name: string
	quantity: string
	unit: string
}

type SpeechToTextOptions = {
	onResult: (items: TranscribedItem[], transcription: string | null) => void
	onError?: (message: string) => void
}

// Silence detection settings
const SILENCE_THRESHOLD = 0.01 // RMS below this = silence
const SILENCE_DURATION_MS = 1500 // Auto-stop after this much silence
const MIN_RECORDING_MS = 500 // Don't auto-stop before this
const MAX_RECORDING_MS = 30_000 // Safety net: auto-stop after 30s

export function useSpeechToText({ onResult, onError }: SpeechToTextOptions) {
	const [isRecording, setIsRecording] = useState(false)
	const [isTranscribing, setIsTranscribing] = useState(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const chunksRef = useRef<Blob[]>([])
	const audioContextRef = useRef<AudioContext | null>(null)
	const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const rafRef = useRef<number | null>(null)

	const cleanupAudioMonitoring = useCallback(() => {
		if (maxTimerRef.current) {
			clearTimeout(maxTimerRef.current)
			maxTimerRef.current = null
		}
		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current)
			rafRef.current = null
		}
		if (audioContextRef.current) {
			void audioContextRef.current.close()
			audioContextRef.current = null
		}
	}, [])

	// Clean up on unmount
	useEffect(() => {
		return () => {
			cleanupAudioMonitoring()
			const recorder = mediaRecorderRef.current
			if (recorder && recorder.state === 'recording') {
				recorder.stop()
			}
		}
	}, [cleanupAudioMonitoring])

	const stopRecording = useCallback(() => {
		cleanupAudioMonitoring()
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state === 'recording'
		) {
			mediaRecorderRef.current.stop()
			setIsRecording(false)
		}
	}, [cleanupAudioMonitoring])

	const startRecording = useCallback(async () => {
		// Guard against double-tap race condition
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state === 'recording'
		) {
			return
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			})

			// Prefer webm, fall back to whatever the browser supports
			const mimeType = MediaRecorder.isTypeSupported('audio/webm')
				? 'audio/webm'
				: MediaRecorder.isTypeSupported('audio/mp4')
					? 'audio/mp4'
					: ''

			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			)
			mediaRecorderRef.current = recorder
			chunksRef.current = []

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					chunksRef.current.push(e.data)
				}
			}

			recorder.onstop = async () => {
				cleanupAudioMonitoring()
				// Stop all tracks to release the microphone
				stream.getTracks().forEach((t) => t.stop())

				const blob = new Blob(chunksRef.current, {
					type: mimeType || 'audio/webm',
				})
				chunksRef.current = []

				if (blob.size === 0) {
					onError?.('No audio recorded. Please try again.')
					return
				}

				setIsTranscribing(true)
				try {
					const formData = new FormData()
					const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
					formData.append(
						'audio',
						new File([blob], `recording.${ext}`, { type: blob.type }),
					)

					const response = await fetch('/resources/transcribe', {
						method: 'POST',
						body: formData,
					})

					if (!response.ok) {
						try {
							const errorData = (await response.json()) as {
								error?: string
							}
							onError?.(
								errorData.error ||
									'Voice transcription failed. Please try again.',
							)
						} catch {
							onError?.('Voice transcription failed. Please try again.')
						}
						return
					}

					const data = (await response.json()) as {
						error: string | null
						items: TranscribedItem[]
						transcription: string | null
					}

					if (data.error) {
						onError?.(data.error)
					} else {
						onResult(data.items, data.transcription)
					}
				} catch {
					onError?.('Failed to transcribe audio. Please try again.')
				} finally {
					setIsTranscribing(false)
				}
			}

			recorder.start()
			setIsRecording(true)

			// Set up silence detection via Web Audio API
			const audioContext = new AudioContext()
			audioContextRef.current = audioContext
			// Ensure AudioContext is running (iOS Safari may start suspended)
			if (audioContext.state === 'suspended') {
				await audioContext.resume()
			}
			const source = audioContext.createMediaStreamSource(stream)
			const analyser = audioContext.createAnalyser()
			analyser.fftSize = 512
			source.connect(analyser)

			const dataArray = new Float32Array(analyser.fftSize)
			const startTime = Date.now()
			let hasSpeech = false
			let silenceStart: number | null = null

			function checkAudioLevel() {
				if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
					return
				}

				analyser.getFloatTimeDomainData(dataArray)

				// Calculate RMS (root mean square) for volume level
				let sum = 0
				for (let i = 0; i < dataArray.length; i++) {
					sum += dataArray[i]! * dataArray[i]!
				}
				const rms = Math.sqrt(sum / dataArray.length)

				const elapsed = Date.now() - startTime

				if (rms > SILENCE_THRESHOLD) {
					// Sound detected
					hasSpeech = true
					silenceStart = null
				} else if (hasSpeech && elapsed > MIN_RECORDING_MS) {
					// Silence after speech
					if (silenceStart === null) {
						silenceStart = Date.now()
					} else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
						// Enough silence — auto-stop
						stopRecording()
						return
					}
				}

				rafRef.current = requestAnimationFrame(checkAudioLevel)
			}

			rafRef.current = requestAnimationFrame(checkAudioLevel)

			// Safety net: max recording duration
			maxTimerRef.current = setTimeout(() => {
				stopRecording()
			}, MAX_RECORDING_MS)
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotAllowedError') {
				onError?.(
					'Microphone access denied. Please allow microphone access and try again.',
				)
			} else if (
				error instanceof DOMException &&
				error.name === 'NotFoundError'
			) {
				onError?.('No microphone found on this device.')
			} else {
				onError?.('Could not start recording. Please try again.')
			}
		}
	}, [onResult, onError, stopRecording, cleanupAudioMonitoring])

	return {
		isRecording,
		isTranscribing,
		startRecording,
		stopRecording,
	}
}
