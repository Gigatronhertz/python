export const EXAMPLES = [
  {
    id: 'chatbot',
    name: 'Chatbot (while loop + input)',
    code: `# A chatbot: the while loop keeps running and every input()
# is typed right here in the terminal, next to the output.
# Type "bye" to end the conversation.

import random

greetings = ["Hey!", "Hello there.", "Hi!"]
print(random.choice(greetings), "I'm PyBot. What's your name?")

name = input("You: ")
print(f"PyBot: Nice to meet you, {name}.")
print("PyBot: Ask me anything, or type 'bye' to leave.")

turns = 0
while True:
    message = input(f"{name}: ").strip()
    turns += 1

    if message.lower() in ("bye", "quit", "exit"):
        print(f"PyBot: Goodbye {name}! We talked for {turns} turns.")
        break

    if not message:
        print("PyBot: ...say something?")
    elif message.endswith("?"):
        print("PyBot:", random.choice([
            "Good question. I genuinely have no idea.",
            "Probably yes.",
            "Ask me again after my coffee.",
        ]))
    elif "python" in message.lower():
        print("PyBot: Python is my whole personality.")
    else:
        print(f"PyBot: '{message}' — interesting. Tell me more.")
`,
  },
  {
    id: 'guess',
    name: 'Number guessing game',
    code: `import random

secret = random.randint(1, 100)
tries = 0

print("I'm thinking of a number between 1 and 100.")

while True:
    raw = input("Your guess: ")

    if not raw.strip().isdigit():
        print("Please type a whole number.")
        continue

    guess = int(raw)
    tries += 1

    if guess < secret:
        print("Too low.")
    elif guess > secret:
        print("Too high.")
    else:
        print(f"Got it! {secret} in {tries} tries.")
        break
`,
  },
  {
    id: 'menu',
    name: 'Menu-driven calculator',
    code: `def add(a, b): return a + b
def sub(a, b): return a - b
def mul(a, b): return a * b
def div(a, b): return a / b if b else "undefined"

OPS = {"1": ("add", add), "2": ("subtract", sub),
       "3": ("multiply", mul), "4": ("divide", div)}

while True:
    print()
    print("=== Calculator ===")
    for key, (label, _) in OPS.items():
        print(f"  {key}. {label}")
    print("  q. quit")

    choice = input("Choose: ").strip().lower()
    if choice == "q":
        print("Bye.")
        break
    if choice not in OPS:
        print("Not an option.")
        continue

    label, fn = OPS[choice]
    try:
        a = float(input("First number:  "))
        b = float(input("Second number: "))
    except ValueError:
        print("That wasn't a number.")
        continue

    print(f"{label}: {fn(a, b)}")
`,
  },
  {
    id: 'basics',
    name: 'Language tour',
    code: `from dataclasses import dataclass
from collections import Counter
import math


@dataclass
class Planet:
    name: str
    radius_km: float

    @property
    def volume(self) -> float:
        return (4 / 3) * math.pi * self.radius_km ** 3


planets = [Planet("Mercury", 2439.7), Planet("Earth", 6371.0), Planet("Mars", 3389.5)]

for p in sorted(planets, key=lambda p: -p.volume):
    print(f"{p.name:<8} r={p.radius_km:>8.1f} km   V={p.volume:.3e} km^3")

print()
words = "the quick brown fox jumps over the lazy dog the end".split()
print("word counts:", Counter(words).most_common(3))

squares = {n: n ** 2 for n in range(1, 6)}
print("squares:", squares)


def fib(limit):
    a, b = 0, 1
    while a < limit:
        yield a
        a, b = b, a + b


print("fib:", list(fib(100)))
`,
  },
  {
    id: 'countdown',
    name: 'Long loop (try the Stop button)',
    code: `import time

# An infinite loop. Press Stop (or Ctrl+C in the terminal)
# to raise KeyboardInterrupt, exactly like a real terminal.

n = 0
while True:
    n += 1
    print(f"tick {n}")
    time.sleep(0.5)
`,
  },
];

export const DEFAULT_CODE = EXAMPLES[0].code;
