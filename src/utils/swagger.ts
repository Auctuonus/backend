import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export default function injectSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Auctionus API')
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description:
          'Enter the Telegram Mini App init data in the format: tma <init-data>',
      },
      'TMA',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token (without Bearer prefix)',
      },
      'JWT',
    )
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory, {
    customSiteTitle: 'Auctionus API Docs',
    customCss: `
      .information-container { 
        display: flex !important; 
        align-items: center !important; 
        justify-content: space-between !important; 
      }
      .swagger-export-btn {
        background: #49cc90 !important;
        color: white !important;
        border: 1px solid #49cc90 !important;
        padding: 10px 20px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        transition: all 0.2s ease !important;
        margin-left: 20px !important;
        white-space: nowrap !important;
      }
      .swagger-export-btn:hover {
        background: #3da876 !important;
        border-color: #3da876 !important;
      }
    `,
    customfavIcon:
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMGQxYjIiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTZWOGEyIDIgMCAwIDAtMS0xLjczbC03LTRhMiAyIDAgMCAwLTIgMGwtNyA0QTIgMiAwIDAgMCAzIDh2OGEyIDIgMCAwIDAgMSAxLjczbDcgNGEyIDIgMCAwIDAgMiAwbDctNEEyIDIgMCAwIDAgMjEgMTZ6Ii8+PC9zdmc+',
    swaggerOptions: {
      persistAuthorization: true,
    },
    customJsStr: `
      function addExportButton() {
        if (document.querySelector('.swagger-export-btn')) return;
        
        const infoContainer = document.querySelector('.information-container');
        if (infoContainer) {
          const exportButton = document.createElement('button');
          exportButton.className = 'swagger-export-btn';
          exportButton.innerHTML = '📥 Export Swagger JSON';
          exportButton.onclick = function() {
            fetch('/api-json')
              .then(response => response.json())
              .then(data => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'swagger-' + new Date().toISOString().split('T')[0] + '.json';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
              })
              .catch(error => {
                console.error('Error downloading Swagger JSON:', error);
                alert('Failed to download Swagger JSON');
              });
          };
          infoContainer.appendChild(exportButton);
        }
      }
      
      window.addEventListener('load', function() {
        setTimeout(addExportButton, 100);
        setTimeout(addExportButton, 500);
        setTimeout(addExportButton, 1000);
      });
    `,
  });
}
