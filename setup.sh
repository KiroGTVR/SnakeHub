#!/bin/bash
# SnakeHub Setup & Run Script

echo "═══════════════════════════════════"
echo "  SnakeHub — Setup"
echo "═══════════════════════════════════"

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

echo ""
echo "═══════════════════════════════════"
echo "  Setup complete!"
echo "  Run:  source venv/bin/activate"
echo "        python app.py"
echo "  Then open: http://localhost:5000"
echo "═══════════════════════════════════"
