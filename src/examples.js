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
    id: 'pygame',
    name: 'pygame: coin collector',
    code: `# A pygame game. The window opens above the terminal.
# Click it, then use the arrow keys (or WASD) to collect coins.
# Close it with the ✕ button, Esc, or the Stop button.

import random
import pygame

pygame.init()
screen = pygame.display.set_mode((480, 360))
pygame.display.set_caption("Coin collector")
clock = pygame.time.Clock()
font = pygame.font.Font(None, 32)

player = pygame.Rect(220, 160, 32, 32)
coin = pygame.Rect(0, 0, 16, 16)
speed = 4
score = 0


def move_coin():
    coin.topleft = (random.randint(0, 464), random.randint(40, 344))


move_coin()
running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            running = False

    keys = pygame.key.get_pressed()
    dx = (keys[pygame.K_RIGHT] or keys[pygame.K_d]) - (keys[pygame.K_LEFT] or keys[pygame.K_a])
    dy = (keys[pygame.K_DOWN] or keys[pygame.K_s]) - (keys[pygame.K_UP] or keys[pygame.K_w])
    player.x += dx * speed
    player.y += dy * speed
    player.clamp_ip(screen.get_rect())

    if player.colliderect(coin):
        score += 1
        print("Coin! Score:", score)
        move_coin()

    screen.fill((18, 24, 38))
    pygame.draw.ellipse(screen, (247, 198, 107), coin)
    pygame.draw.rect(screen, (93, 220, 154), player, border_radius=6)
    screen.blit(font.render(f"Score: {score}", True, (214, 222, 235)), (10, 8))
    pygame.display.flip()
    clock.tick(60)

pygame.quit()
print("Thanks for playing! Final score:", score)
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
