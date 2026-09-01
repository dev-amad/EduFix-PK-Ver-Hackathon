import os
from markitdown import MarkItDown

md = MarkItDown()
base_dir = './knowledge-base-source'

print('Starting batch PDF to Markdown conversion...')

for root, _, files in os.walk(base_dir):
    for file in files:
        if file.endswith('.pdf'):
            pdf_path = os.path.join(root, file)
            md_path = pdf_path.replace('.pdf', '.md')
            
            if os.path.exists(md_path):
                print(f'Skipping (Already Converted): {file}')
                continue

            print(f'Converting: {file} -> {os.path.basename(md_path)}')
            try:
                result = md.convert(pdf_path)
                with open(md_path, 'w', encoding='utf-8') as f:
                    f.write(result.text_content)
            except Exception as e:
                print(f'Error converting {file}: {e}')

print('All files converted successfully!')
